/*
 * Firmio – Dokumente per Handy unterschreiben
 * Alles läuft im Browser. Was über den Server geht (Dokument im Link, Rückgabe),
 * ist Ende-zu-Ende verschlüsselt; der Schlüssel steckt nur im Link hinter dem #.
 * Bibliotheken: pdf.js (Anzeige), pdf-lib (Unterschrift ins PDF schreiben).
 */
'use strict';
(function () {
  if (!('PointerEvent' in window) || !window.Promise || !window.Uint8Array || !window.Blob || !window.URL) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML = '<main class="start"><h1>Bitte Browser aktualisieren</h1><p class="lead">Ihr Browser ist zu alt für diese Seite. Bitte aktualisieren Sie ihn oder öffnen Sie den Link in Chrome oder Safari.</p></main>';
    });
    return;
  }

  const CFG = Object.assign({ anbieter: '', impressum: '', datenschutz: '' }, window.UNTERSCHRIFT_CONFIG || {});
  const INK = [27, 58, 143];
  const INK_CSS = 'rgb(27,58,143)';
  const CAP = [74, 90, 112];
  const CAP_CSS = 'rgb(74,90,112)';
  const LS_SENDER = 'unterschrift.absender.v1';

  /* ---------------- Helfer ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  function el(tag, attrs) {
    const n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'value') n.value = v;
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      n.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const r2 = n => Math.round(n * 100) / 100;
  const r1 = n => Math.round(n * 10) / 10;
  const fmtDate = d => pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
  const fmtTime = (d, sec) => pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + (sec ? ':' + pad2(d.getSeconds()) : '');
  const fmtSize = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, one, many) => n === 1 ? one : many;
  function debounce(fn, ms) { let t = 0; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  const SQ = {
    "Dokumente sicher unterschreiben": "Nënshkrim i sigurt i dokumenteve",
    "mit Firmio sicher unterschreiben": "nënshkrim i sigurt me Firmio",
    "Dokument unterschreiben": "Nënshkruani dokumentin",
    "Ihr Dokument steckt schon im Link. Sie müssen nichts speichern und nichts herunterladen.": "Dokumenti juaj ndodhet tashmë në link. Nuk keni nevojë të ruani apo të shkarkoni asgjë.",
    "Unterschreiben Sie ein PDF direkt auf Ihrem Handy, ganz ohne Drucker.": "Nënshkruani një PDF direkt në telefonin tuaj, pa pasur nevojë për printer.",
    "Ende-zu-Ende verschlüsselt. Ihre Unterschrift wird nicht hochgeladen, und das Dokument wird nach dem Zurückschicken gelöscht.": "I enkriptuar nga skaji në skaj. Nënshkrimi juaj nuk ngarkohet askund dhe dokumenti fshihet pasi ta keni kthyer të nënshkruar.",
    "Ihr Dokument bleibt auf Ihrem Gerät. Es wird nichts hochgeladen und nichts gespeichert.": "Dokumenti juaj mbetet në pajisjen tuaj. Asgjë nuk ngarkohet dhe asgjë nuk ruhet.",
    "So geht’s": "Si funksionon",
    "Dokument öffnen": "Hapni dokumentin",
    "Es ist schon im Link enthalten und öffnet sich von selbst.": "Ndodhet tashmë në link dhe hapet vetvetiu.",
    "Mit dem Finger unterschreiben": "Nënshkruani me gisht",
    "Die markierten Stellen werden automatisch ausgefüllt.": "Vendet e shënuara plotësohen automatikisht.",
    "Danach schieben Sie die Unterschrift an die richtige Stelle.": "Pastaj e zhvendosni nënshkrimin në vendin e duhur.",
    "Zurückschicken": "Ktheni dokumentin",
    "Das unterschriebene PDF direkt per WhatsApp senden.": "Dërgoni PDF-në e nënshkruar direkt me WhatsApp.",
    "PDF auswählen": "Zgjidhni PDF-në",
    "Das Dokument, das Sie per WhatsApp oder E-Mail bekommen haben.": "Dokumentin që e keni marrë me WhatsApp ose me e-mail.",
    "<b>{who}</b> bittet Sie um Ihre Unterschrift.": "<b>{who}</b> ju kërkon nënshkrimin tuaj.",
    "Sie wurden gebeten, ein Dokument zu unterschreiben.": "Ju është kërkuar të nënshkruani një dokument.",
    "Die Stelle zum Unterschreiben ist schon markiert.": "Vendi për nënshkrim është shënuar tashmë.",
    "{n} Stellen zum Unterschreiben sind schon markiert.": "{n} vende për nënshkrim janë shënuar tashmë.",
    "Wählen Sie unten das PDF aus, das Sie bekommen haben.": "Zgjidhni më poshtë PDF-në që keni marrë.",
    "So finden Sie das PDF auf dem iPhone": "Si ta gjeni PDF-në në iPhone",
    "In WhatsApp das PDF <b>antippen</b>.": "Në WhatsApp <b>prekni</b> PDF-në.",
    "Auf <b>Teilen</b> tippen (Kästchen mit Pfeil) und <b>„In Dateien sichern“</b> wählen.": "Prekni <b>„Teilen“</b> (katrori me shigjetë) dhe zgjidhni <b>„In Dateien sichern“</b>.",
    "Hier auf <b>„PDF auswählen“</b> tippen, dann unter <b>„Zuletzt“</b> oder <b>„Durchsuchen“</b> das PDF antippen.": "Këtu prekni <b>„Zgjidhni PDF-në“</b>, pastaj te <b>„Zuletzt“</b> ose <b>„Durchsuchen“</b> prekni PDF-në.",
    "So finden Sie das PDF auf Android": "Si ta gjeni PDF-në në Android",
    "In WhatsApp das PDF einmal <b>antippen</b>, damit es geladen ist.": "Në WhatsApp <b>prekni</b> PDF-në një herë, që të shkarkohet.",
    "Hier auf <b>„PDF auswählen“</b> tippen.": "Këtu prekni <b>„Zgjidhni PDF-në“</b>.",
    "Unter <b>„Zuletzt“</b> oder <b>„Dokumente“</b> das PDF antippen. Es liegt meist im Ordner <b>„WhatsApp Documents“</b>.": "Te <b>„Zuletzt“</b> ose <b>„Dokumente“</b> prekni PDF-në. Zakonisht ndodhet në dosjen <b>„WhatsApp Documents“</b>.",
    "Das PDF kam per E-Mail?": "PDF-ja ju erdhi me e-mail?",
    "Speichern Sie den Anhang und wählen Sie ihn hier mit „PDF auswählen“ aus.": "Ruajeni shtojcën dhe zgjidheni këtu me „Zgjidhni PDF-në“.",
    "Datenschutz": "Mbrojtja e të dhënave",
    "Für Absender: Unterschrift anfordern": "Për dërguesit: kërkoni nënshkrim",
    "<p><b>Ihr Dokument bleibt auf Ihrem Gerät.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Nichts davon wird hochgeladen, gespeichert oder an Dritte übermittelt.</p>": "<p><b>Dokumenti juaj mbetet në pajisjen tuaj.</b> PDF-ja, emri dhe nënshkrimi juaj përpunohen vetëm në shfletuesin tuaj. Asgjë prej tyre nuk ngarkohet, nuk ruhet dhe nuk u jepet palëve të treta.</p>",
    "<p>Diese Seite verwendet keine Cookies, kein Tracking und keine Analysedienste. Sie ist technisch so eingestellt, dass sie keine Daten an fremde Server senden kann.</p>": "<p>Kjo faqe nuk përdor cookies, ndjekje apo shërbime analize. Teknikisht është ndërtuar në mënyrë që të mos mund të dërgojë të dhëna te serverë të huaj.</p>",
    "<p>Beim Aufruf der Seite verarbeitet der Hosting-Anbieter (Netlify) technisch notwendige Verbindungsdaten wie die IP-Adresse, um die Seite auszuliefern.</p>": "<p>Kur hapni faqen, ofruesi i hostingut (Netlify) përpunon të dhënat teknike të lidhjes, si adresën IP, për ta shfaqur faqen.</p>",
    "<p><b>Dokumente per Link:</b> Schickt Ihnen jemand ein Dokument per Link, wurde es auf seinem Gerät verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Niemand außer Ihnen und dem Absender kann das Dokument lesen. Es wird gelöscht, sobald Sie es unterschrieben zurückgeschickt haben, spätestens nach 7 Tagen.</p>": "<p><b>Dokumente me link:</b> Nëse dikush ju dërgon një dokument me link, ai është enkriptuar në pajisjen e tij dhe ruhet te Netlify vetëm i enkriptuar. Çelësi ndodhet vetëm në link (pas shenjës #) dhe nuk i dërgohet kurrë serverit. Askush përveç jush dhe dërguesit nuk mund ta lexojë dokumentin. Ai fshihet sapo ta keni kthyer të nënshkruar, e më së voni pas 7 ditësh.</p>",
    "<p>Das unterschriebene PDF verschicken Sie selbst, zum Beispiel per WhatsApp. Dafür gelten die Datenschutzbestimmungen des jeweiligen Dienstes.</p>": "<p>PDF-në e nënshkruar e dërgoni vetë, për shembull me WhatsApp. Për këtë vlejnë rregullat e privatësisë së shërbimit përkatës.</p>",
    "<p>Verantwortlich: siehe Impressum.</p>": "<p>Përgjegjësi: shihni Impressum.</p>",
    "Dokument wird geladen …": "Dokumenti po ngarkohet …",
    "{name} · gültig bis {date}": "{name} · i vlefshëm deri më {date}",
    "gültig bis {date}": "i vlefshëm deri më {date}",
    "Dieser Link ist abgelaufen oder das Dokument wurde schon unterschrieben zurückgeschickt. Bitten Sie {who} um einen neuen Link.": "Ky link ka skaduar ose dokumenti është kthyer tashmë i nënshkruar. Kërkoni një link të ri nga {who}.",
    "den Absender": "dërguesi",
    "Der Link ist unvollständig. Bitte öffnen Sie ihn noch einmal direkt aus WhatsApp.": "Linku është i paplotë. Ju lutemi hapeni edhe një herë direkt nga WhatsApp.",
    "Das Dokument konnte nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung.": "Dokumenti nuk mund të ngarkohej. Ju lutemi kontrolloni lidhjen me internetin.",
    "Erneut versuchen": "Provoni përsëri",
    "Haben Sie das PDF auf dem Handy? Dann können Sie es auch selbst auswählen.": "E keni PDF-në në telefon? Atëherë mund ta zgjidhni edhe vetë.",
    "Die Datei konnte nicht gelesen werden.": "Skedari nuk mund të lexohej.",
    "Dokument wird geöffnet …": "Dokumenti po hapet …",
    "Diese Datei ist kein PDF. Bitte wählen Sie das PDF-Dokument aus.": "Ky skedar nuk është PDF. Ju lutemi zgjidhni dokumentin PDF.",
    "Falsches Passwort. Bitte noch einmal eingeben:": "Fjalëkalim i gabuar. Ju lutemi shkruajeni përsëri:",
    "Das PDF ist mit einem Passwort geschützt. Bitte Passwort eingeben:": "PDF-ja është e mbrojtur me fjalëkalim. Ju lutemi shkruani fjalëkalimin:",
    "Die Seite wurde nicht vollständig geladen. Bitte laden Sie sie neu.": "Faqja nuk u ngarkua plotësisht. Ju lutemi ringarkojeni.",
    "Das PDF konnte nicht geöffnet werden. Ist die Datei vollständig heruntergeladen?": "PDF-ja nuk mund të hapej. A është shkarkuar skedari plotësisht?",
    "Seite {a} von {b}": "Faqja {a} nga {b}",
    "Seite {n}": "Faqja {n}",
    "Zurück": "Mbrapa",
    "Dieses PDF passt nicht zur Anfrage (andere Seitenzahl). Bitte prüfen Sie, ob Sie das richtige Dokument gewählt haben. Sie können trotzdem unterschreiben und die Unterschrift selbst platzieren.": "Ky PDF nuk përputhet me kërkesën (numër tjetër faqesh). Ju lutemi kontrolloni nëse keni zgjedhur dokumentin e duhur. Gjithsesi mund të nënshkruani dhe ta vendosni nënshkrimin vetë.",
    "Dieses PDF ist nicht genau das angeforderte Dokument. Wählen Sie am besten das PDF aus der Nachricht. Sie können trotzdem unterschreiben.": "Ky PDF nuk është saktësisht dokumenti i kërkuar. Më mirë zgjidhni PDF-në nga mesazhi. Gjithsesi mund të nënshkruani.",
    "Die gelb markierte Stelle wird nach dem Unterschreiben automatisch ausgefüllt.": "Vendi i shënuar me të verdhë plotësohet automatikisht pasi të nënshkruani.",
    "Die {n} gelb markierten Stellen werden nach dem Unterschreiben automatisch ausgefüllt.": "{n} vendet e shënuara me të verdhë plotësohen automatikisht pasi të nënshkruani.",
    "Die markierten Stellen sind ausgefüllt. Prüfen Sie kurz alles und tippen Sie dann auf „Fertig“.": "Vendet e shënuara u plotësuan. Kontrolloni shkurt gjithçka dhe pastaj prekni „Gati“.",
    "Hinweis schließen": "Mbyll njoftimin",
    "Hier unterschreiben": "Nënshkruani këtu",
    "Ort, Datum": "Vendi, data",
    "Ort und Datum einsetzen": "Vendosni vendin dhe datën",
    "Jetzt unterschreiben": "Nënshkruani tani",
    "Unterschreiben": "Nënshkruani",
    "Unterschrift einsetzen": "Vendosni nënshkrimin",
    "Fertig – PDF erstellen": "Gati – krijoni PDF-në",
    "Hinzufügen": "Shtoni",
    "Entfernen": "Hiqni",
    "Eingesetzt. Zum Verschieben ziehen.": "U vendos. Tërhiqeni për ta zhvendosur.",
    "Unterschrift an {n} Stellen eingesetzt. Bitte kurz prüfen.": "Nënshkrimi u vendos në {n} vende. Ju lutemi kontrolloni shkurt.",
    "Unterschrift eingesetzt. Bitte kurz prüfen.": "Nënshkrimi u vendos. Ju lutemi kontrolloni shkurt.",
    "Schieben Sie die Unterschrift an die richtige Stelle. Größe ändern: blauen Punkt ziehen.": "Zhvendoseni nënshkrimin në vendin e duhur. Për madhësinë: tërhiqni pikën blu.",
    "Unterschrift geändert.": "Nënshkrimi u ndryshua.",
    "Zum Verschieben ziehen. Nochmal antippen zum Ändern.": "Tërhiqeni për ta zhvendosur. Prekeni përsëri për ta ndryshuar.",
    "Bitte zuerst unterschreiben.": "Ju lutemi nënshkruani fillimisht.",
    "PDF wird gespeichert.": "PDF-ja po ruhet.",
    "Danke! Sie können die Seite jetzt schließen.": "Faleminderit! Tani mund ta mbyllni faqen.",
    "Teilen hat nicht geklappt. Bitte „PDF speichern“ nutzen.": "Dërgimi nuk funksionoi. Ju lutemi përdorni „Ruani PDF-në“.",
    "Neues Dokument öffnen? Das unterschriebene PDF wurde noch nicht gesendet oder gespeichert.": "Të hapet një dokument i ri? PDF-ja e nënshkruar ende nuk është dërguar ose ruajtur.",
    "Dokument schließen? Ihre Unterschrift geht dabei verloren.": "Ta mbyllni dokumentin? Nënshkrimi juaj do të humbasë.",
    "Eine markierte Stelle ist noch leer. Trotzdem fertigstellen?": "Një vend i shënuar është ende bosh. Të përfundohet gjithsesi?",
    "{n} markierte Stellen sind noch leer. Trotzdem fertigstellen?": "{n} vende të shënuara janë ende bosh. Të përfundohet gjithsesi?",
    "Das PDF konnte nicht erstellt werden. Bitte versuchen Sie es noch einmal.": "PDF-ja nuk mund të krijohej. Ju lutemi provoni përsëri.",
    "PDF wird erstellt …": "PDF-ja po krijohet …",
    "Seite {a} von {b} wird übernommen …": "Po përpunohet faqja {a} nga {b} …",
    "Einen Moment …": "Një moment …",
    "Unterschrift ändern": "Ndryshoni nënshkrimin",
    "Ihr Name": "Emri juaj",
    "Vor- und Nachname": "Emri dhe mbiemri",
    "Ort (für „Ort, Datum“)": "Vendi (për „Vendi, data“)",
    "Ort (optional)": "Vendi (jo i detyrueshëm)",
    "z. B. Remscheid": "p.sh. Remscheid",
    "Ihre Unterschrift": "Nënshkrimi juaj",
    "Löschen": "Fshini",
    "Hier mit dem Finger unterschreiben": "Nënshkruani këtu me gisht",
    "Unterschriftsfeld": "Fusha e nënshkrimit",
    "Mit „Übernehmen“ bestätigen Sie, dass dies Ihre Unterschrift ist. Damit unterschreiben Sie das Dokument elektronisch.": "Me „Konfirmo“ vërtetoni se ky është nënshkrimi juaj. Kështu e nënshkruani dokumentin në mënyrë elektronike.",
    "Übernehmen": "Konfirmo",
    "Bitte geben Sie Ihren Namen ein.": "Ju lutemi shkruani emrin tuaj.",
    "Bitte unterschreiben Sie im weißen Feld.": "Ju lutemi nënshkruani në fushën e bardhë.",
    "Unterschrift einfügen": "Shtoni nënshkrimin",
    "Auf Seite {n}, dann an die Stelle schieben": "Në faqen {n}, pastaj zhvendoseni në vend",
    "Ort und Datum einfügen": "Shtoni vendin dhe datën",
    "Text einfügen": "Shtoni tekst",
    "Zum Beispiel Ihr Name in Druckschrift": "Për shembull emrin tuaj me shkronja shtypi",
    "Unterschrift neu zeichnen": "Vizatoni nënshkrimin përsëri",
    "Ersetzt die Unterschrift überall": "E zëvendëson nënshkrimin kudo",
    "Text ändern": "Ndryshoni tekstin",
    "Text": "Teksti",
    "Text eingeben": "Shkruani tekstin",
    "Speichern": "Ruaj",
    "Einfügen": "Shto",
    "Schließen": "Mbyll",
    "Fertig unterschrieben": "Dokumenti u nënshkrua",
    "Schicken Sie das PDF jetzt an {who} zurück, am einfachsten per WhatsApp.": "Tani dërgojeni PDF-në te {who}, më së lehti me WhatsApp.",
    "Schicken Sie das PDF jetzt zurück, am einfachsten per WhatsApp.": "Tani dërgojeni PDF-në mbrapsht, më së lehti me WhatsApp.",
    "{n} Seiten": "{n} faqe",
    "1 Seite": "1 faqe",
    "Per WhatsApp zurückschicken": "Dërgojeni me WhatsApp",
    "Im nächsten Schritt WhatsApp wählen und dann den Chat mit {who}.": "Në hapin tjetër zgjidhni WhatsApp dhe pastaj bisedën me {who}.",
    "Im nächsten Schritt WhatsApp wählen und dann den Chat, aus dem Sie das Dokument bekommen haben.": "Në hapin tjetër zgjidhni WhatsApp dhe pastaj bisedën nga e cila e morët dokumentin.",
    "Speichern Sie das PDF und hängen Sie es in WhatsApp über die Büroklammer als „Dokument“ an.": "Ruajeni PDF-në dhe bashkëngjiteni në WhatsApp përmes kapëses si „Dokument“.",
    "PDF speichern": "Ruani PDF-në",
    "Zurück zum Dokument": "Kthehuni te dokumenti",
    "Neues Dokument": "Dokument i ri",
    "Dokument": "Dokumenti",
    "Ende-zu-Ende verschlüsselt. Nur Sie und {who} können das Dokument lesen.": "I enkriptuar nga skaji në skaj. Vetëm ju dhe {who} mund ta lexoni dokumentin.",
    "Ende-zu-Ende verschlüsselt. Nur Sie und der Absender können das Dokument lesen.": "I enkriptuar nga skaji në skaj. Vetëm ju dhe dërguesi mund ta lexoni dokumentin.",
    "Fertig tippen": "Prekni „Gati“",
    "Das unterschriebene Dokument geht automatisch an {who}. Sie müssen nichts zurückschicken.": "Dokumenti i nënshkruar dërgohet automatikisht te {who}. Nuk keni nevojë ta ktheni vetë.",
    "Das unterschriebene Dokument geht automatisch an den Absender. Sie müssen nichts zurückschicken.": "Dokumenti i nënshkruar dërgohet automatikisht te dërguesi. Nuk keni nevojë ta ktheni vetë.",
    "Fertig – Dokument senden": "Gati – dërgoni dokumentin",
    "Wird verschlüsselt gesendet …": "Po dërgohet i enkriptuar …",
    "Wird verschlüsselt gesendet … {p} %": "Po dërgohet i enkriptuar … {p} %",
    "Erledigt!": "U krye!",
    "Fertig!": "Gati!",
    "Verschlüsselt übertragen. Das unterschriebene Dokument geht direkt an {who}.": "I transmetuar i enkriptuar. Dokumenti i nënshkruar shkon direkt te {who}.",
    "Verschlüsselt übertragen. Das unterschriebene Dokument geht direkt an den Absender.": "I transmetuar i enkriptuar. Dokumenti i nënshkruar shkon direkt te dërguesi.",
    "<p><b>Verschlüsselt.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt.</p>": "<p><b>I enkriptuar.</b> PDF-ja, emri dhe nënshkrimi juaj përpunohen vetëm në shfletuesin tuaj. Transmetohet vetëm dokumenti përfundimtar, dhe atë i enkriptuar.</p>",
    "<p><b>Kopie per E-Mail:</b> Der Absender bekommt das unterschriebene Dokument zusätzlich per E-Mail. Dafür wird es verschlüsselt (TLS) an den Server übertragen und von dort per E-Mail an den Absender geschickt. Der Server speichert diese Kopie nicht.</p>": "<p><b>Kopje me e-mail:</b> Dërguesi e merr dokumentin e nënshkruar edhe me e-mail. Për këtë, dokumenti transmetohet i enkriptuar (TLS) te serveri dhe prej andej i dërgohet dërguesit me e-mail. Serveri nuk e ruan këtë kopje.</p>",
    "Vor Ort": "Në vend",
    "Danke! Sie können das Handy jetzt zurückgeben.": "Faleminderit! Tani mund ta ktheni telefonin.",
    "Ihr unterschriebenes Dokument ist bei {who} angekommen. Sie müssen nichts mehr tun.": "Dokumenti juaj i nënshkruar mbërriti te {who}. Nuk keni nevojë të bëni asgjë tjetër.",
    "Ihr unterschriebenes Dokument ist beim Absender angekommen. Sie müssen nichts mehr tun.": "Dokumenti juaj i nënshkruar mbërriti te dërguesi. Nuk keni nevojë të bëni asgjë tjetër.",
    "Sie können die Seite jetzt schließen.": "Tani mund ta mbyllni faqen.",
    "Kopie für mich speichern": "Ruani një kopje për vete",
    "Noch nicht gesendet": "Ende nuk është dërguar",
    "Das Senden hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es noch einmal.": "Dërgimi nuk funksionoi. Ju lutemi kontrolloni lidhjen me internetin dhe provoni përsëri.",
    "Der Link ist abgelaufen. Bitte schicken Sie das PDF per WhatsApp zurück.": "Linku ka skaduar. Ju lutemi dërgojeni PDF-në me WhatsApp.",
    "Für diesen Link wurde schon ein unterschriebenes Dokument übermittelt. Möchten Sie etwas ändern, schicken Sie das PDF bitte per WhatsApp.": "Për këtë link është dërguar tashmë një dokument i nënshkruar. Nëse doni të ndryshoni diçka, ju lutemi dërgojeni PDF-në me WhatsApp.",
    "Das Dokument ist zu groß zum Senden. Bitte schicken Sie das PDF per WhatsApp zurück.": "Dokumenti është shumë i madh për t’u dërguar. Ju lutemi dërgojeni PDF-në me WhatsApp.",
    "Erneut senden": "Dërgoni përsëri",
    "Dieses Dokument wurde bereits unterschrieben und an {who} übermittelt. Sie müssen nichts mehr tun.": "Ky dokument është nënshkruar tashmë dhe është dërguar te {who}. Nuk keni nevojë të bëni asgjë tjetër.",
    "Dieses Dokument wurde bereits unterschrieben und an den Absender übermittelt. Sie müssen nichts mehr tun.": "Ky dokument është nënshkruar tashmë dhe është dërguar te dërguesi. Nuk keni nevojë të bëni asgjë tjetër.",
    "Bereits unterschrieben": "Tashmë i nënshkruar",
    "Unterschrieben am {date} um {time} Uhr.": "Nënshkruar më {date} në orën {time}.",
    "<p><b>Ende-zu-Ende verschlüsselt.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt: Lesen können es nur Sie und der Absender.</p>": "<p><b>I enkriptuar nga skaji në skaj.</b> PDF-ja, emri dhe nënshkrimi juaj përpunohen vetëm në shfletuesin tuaj. Transmetohet vetëm dokumenti përfundimtar, dhe atë i enkriptuar: mund ta lexoni vetëm ju dhe dërguesi.</p>",
    "<p><b>Dokumente per Link:</b> Das Dokument wurde auf dem Gerät des Absenders verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Wenn Sie auf „Fertig“ tippen, wird das unterschriebene Dokument auf Ihrem Gerät mit diesem Schlüssel verschlüsselt und für den Absender bereitgelegt. Danach wird das Original gelöscht. Das unterschriebene Dokument wird gelöscht, sobald der Absender es abgeholt hat, spätestens nach 30 Tagen. Nicht unterschriebene Dokumente werden nach 7 Tagen gelöscht.</p>": "<p><b>Dokumente me link:</b> Dokumenti është enkriptuar në pajisjen e dërguesit dhe ruhet te Netlify vetëm i enkriptuar. Çelësi ndodhet vetëm në link (pas shenjës #) dhe nuk i dërgohet kurrë serverit. Kur prekni „Gati“, dokumenti i nënshkruar enkriptohet në pajisjen tuaj me këtë çelës dhe i vihet në dispozicion dërguesit. Pastaj origjinali fshihet. Dokumenti i nënshkruar fshihet sapo dërguesi ta ketë marrë, e më së voni pas 30 ditësh. Dokumentet e panënshkruara fshihen pas 7 ditësh.</p>",
    "{n} Dokumente": "{n} dokumente",
    "Dokument {a} von {b}": "Dokumenti {a} nga {b}",
    "Stimmt etwas nicht?": "Diçka nuk është në rregull?",
    "Dann nicht unterschreiben, sondern kurz Bescheid geben.": "Atëherë mos nënshkruani, por njoftoni shkurt.",
    "Bescheid geben": "Njoftoni",
    "z. B. Mein Geburtsdatum stimmt nicht.": "p.sh. Data ime e lindjes nuk është e saktë.",
    "Nachricht senden": "Dërgoni mesazhin",
    "Schreiben Sie kurz, was geändert werden soll. Die Nachricht geht an {who}. Unterschreiben müssen Sie dann noch nicht.": "Shkruani shkurt se çfarë duhet ndryshuar. Mesazhi shkon te {who}. Atëherë nuk keni nevojë të nënshkruani ende.",
    "Was soll geändert werden?": "Çfarë duhet ndryshuar?",
    "Bitte schreiben Sie kurz, was nicht stimmt.": "Ju lutemi shkruani shkurt se çfarë nuk është në rregull.",
    "Danke! Ihre Nachricht ist verschlüsselt an {who} gegangen.": "Faleminderit! Mesazhi juaj u dërgua i enkriptuar te {who}.",
    "Sie haben schon mehrere Nachrichten geschickt. Bitte schreiben Sie direkt per WhatsApp.": "Keni dërguar tashmë disa mesazhe. Ju lutemi shkruani direkt në WhatsApp.",
    "Senden hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung.": "Dërgimi nuk funksionoi. Ju lutemi kontrolloni lidhjen me internetin.",
    "Kurz Bescheid geben statt unterschreiben": "Njoftoni shkurt në vend që të nënshkruani",
    "1. Person": "Personi 1",
    "2. Person": "Personi 2",
    "die 1. Person": "personi 1",
    "die 2. Person": "personi 2",
    "Zwei Personen unterschreiben nacheinander: zuerst {a}, dann {b}.": "Dy persona nënshkruajnë njëri pas tjetrit: së pari {a}, pastaj {b}.",
    "Zwei Personen unterschreiben nacheinander.": "Dy persona nënshkruajnë njëri pas tjetrit.",
    "Danke! Jetzt unterschreibt {name}. Bitte das Handy weitergeben.": "Faleminderit! Tani nënshkruan {name}. Ju lutemi ia jepni telefonin.",
    "Jetzt unterschreibt {name}": "Tani nënshkruan {name}",
    "Unterschrift: {name}": "Nënshkrimi: {name}",
    "<p><b>Geöffnet und Rückmeldungen:</b> Beim ersten Öffnen des Links merkt sich der Server nur den Zeitpunkt (ohne Namen oder Inhalte), damit der Absender sieht, dass das Dokument angekommen ist. Eine Nachricht über „Stimmt etwas nicht?“ wird wie das Dokument Ende-zu-Ende verschlüsselt und gelöscht, sobald der Absender sie abgeholt hat.</p>": "<p><b>Hapja dhe njoftimet:</b> Kur linku hapet për herë të parë, serveri ruan vetëm kohën (pa emra apo përmbajtje), që dërguesi të shohë se dokumenti ka mbërritur. Një mesazh përmes „Diçka nuk është në rregull?“ enkriptohet nga skaji në skaj si dokumenti dhe fshihet sapo dërguesi ta ketë marrë.</p>"
  };
  // Kundenseite in Du-Form (Deutsch). Schlüssel = Sie-Text. Fehlt ein Eintrag, gilt der Sie-Text (meist neutral).
  const DU = {
    "Ihr Dokument steckt schon im Link. Sie müssen nichts speichern und nichts herunterladen.": "Dein Dokument steckt schon im Link. Du musst nichts speichern und nichts herunterladen.",
    "Unterschreiben Sie ein PDF direkt auf Ihrem Handy, ganz ohne Drucker.": "Unterschreib ein PDF direkt auf deinem Handy, ganz ohne Drucker.",
    "Ende-zu-Ende verschlüsselt. Ihre Unterschrift wird nicht hochgeladen, und das Dokument wird nach dem Zurückschicken gelöscht.": "Ende-zu-Ende verschlüsselt. Deine Unterschrift wird nicht hochgeladen, und das Dokument wird nach dem Zurückschicken gelöscht.",
    "Ihr Dokument bleibt auf Ihrem Gerät. Es wird nichts hochgeladen und nichts gespeichert.": "Dein Dokument bleibt auf deinem Gerät. Es wird nichts hochgeladen und nichts gespeichert.",
    "Danach schieben Sie die Unterschrift an die richtige Stelle.": "Danach schiebst du die Unterschrift an die richtige Stelle.",
    "Das Dokument, das Sie per WhatsApp oder E-Mail bekommen haben.": "Das Dokument, das du per WhatsApp oder E-Mail bekommen hast.",
    "<b>{who}</b> bittet Sie um Ihre Unterschrift.": "<b>{who}</b> bittet dich um deine Unterschrift.",
    "Sie wurden gebeten, ein Dokument zu unterschreiben.": "Du wurdest gebeten, ein Dokument zu unterschreiben.",
    "Wählen Sie unten das PDF aus, das Sie bekommen haben.": "Wähl unten das PDF aus, das du bekommen hast.",
    "So finden Sie das PDF auf dem iPhone": "So findest du das PDF auf dem iPhone",
    "So finden Sie das PDF auf Android": "So findest du das PDF auf Android",
    "Speichern Sie den Anhang und wählen Sie ihn hier mit „PDF auswählen“ aus.": "Speichere den Anhang und wähl ihn hier mit „PDF auswählen“ aus.",
    "<p><b>Ihr Dokument bleibt auf Ihrem Gerät.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Nichts davon wird hochgeladen, gespeichert oder an Dritte übermittelt.</p>": "<p><b>Dein Dokument bleibt auf deinem Gerät.</b> Das PDF, dein Name und deine Unterschrift werden nur in deinem Browser verarbeitet. Nichts davon wird hochgeladen, gespeichert oder an Dritte übermittelt.</p>",
    "<p><b>Dokumente per Link:</b> Schickt Ihnen jemand ein Dokument per Link, wurde es auf seinem Gerät verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Niemand außer Ihnen und dem Absender kann das Dokument lesen. Es wird gelöscht, sobald Sie es unterschrieben zurückgeschickt haben, spätestens nach 7 Tagen.</p>": "<p><b>Dokumente per Link:</b> Schickt dir jemand ein Dokument per Link, wurde es auf seinem Gerät verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Niemand außer dir und dem Absender kann das Dokument lesen. Es wird gelöscht, sobald du es unterschrieben zurückgeschickt hast, spätestens nach 7 Tagen.</p>",
    "<p>Das unterschriebene PDF verschicken Sie selbst, zum Beispiel per WhatsApp. Dafür gelten die Datenschutzbestimmungen des jeweiligen Dienstes.</p>": "<p>Das unterschriebene PDF verschickst du selbst, zum Beispiel per WhatsApp. Dafür gelten die Datenschutzbestimmungen des jeweiligen Dienstes.</p>",
    "Dieser Link ist abgelaufen oder das Dokument wurde schon unterschrieben zurückgeschickt. Bitten Sie {who} um einen neuen Link.": "Dieser Link ist abgelaufen oder das Dokument wurde schon unterschrieben zurückgeschickt. Frag {who} nach einem neuen Link.",
    "Der Link ist unvollständig. Bitte öffnen Sie ihn noch einmal direkt aus WhatsApp.": "Der Link ist unvollständig. Bitte öffne ihn noch einmal direkt aus WhatsApp.",
    "Das Dokument konnte nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung.": "Das Dokument konnte nicht geladen werden. Bitte prüf deine Internetverbindung.",
    "Haben Sie das PDF auf dem Handy? Dann können Sie es auch selbst auswählen.": "Hast du das PDF auf dem Handy? Dann kannst du es auch selbst auswählen.",
    "Diese Datei ist kein PDF. Bitte wählen Sie das PDF-Dokument aus.": "Diese Datei ist kein PDF. Bitte wähl das PDF-Dokument aus.",
    "Die Seite wurde nicht vollständig geladen. Bitte laden Sie sie neu.": "Die Seite wurde nicht vollständig geladen. Bitte lade sie neu.",
    "Dieses PDF passt nicht zur Anfrage (andere Seitenzahl). Bitte prüfen Sie, ob Sie das richtige Dokument gewählt haben. Sie können trotzdem unterschreiben und die Unterschrift selbst platzieren.": "Dieses PDF passt nicht zur Anfrage (andere Seitenzahl). Bitte prüf, ob du das richtige Dokument gewählt hast. Du kannst trotzdem unterschreiben und die Unterschrift selbst platzieren.",
    "Dieses PDF ist nicht genau das angeforderte Dokument. Wählen Sie am besten das PDF aus der Nachricht. Sie können trotzdem unterschreiben.": "Dieses PDF ist nicht genau das angeforderte Dokument. Wähl am besten das PDF aus der Nachricht. Du kannst trotzdem unterschreiben.",
    "Die markierten Stellen sind ausgefüllt. Prüfen Sie kurz alles und tippen Sie dann auf „Fertig“.": "Die markierten Stellen sind ausgefüllt. Prüf kurz alles und tipp dann auf „Fertig“.",
    "Schieben Sie die Unterschrift an die richtige Stelle. Größe ändern: blauen Punkt ziehen.": "Schieb die Unterschrift an die richtige Stelle. Größe ändern: blauen Punkt ziehen.",
    "Danke! Sie können die Seite jetzt schließen.": "Danke! Du kannst die Seite jetzt schließen.",
    "Danke! Sie können das Handy jetzt zurückgeben.": "Danke! Du kannst das Handy jetzt zurückgeben.",
    "<p><b>Verschlüsselt.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt.</p>": "<p><b>Verschlüsselt.</b> Das PDF, dein Name und deine Unterschrift werden nur in deinem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt.</p>",
    "Dokument schließen? Ihre Unterschrift geht dabei verloren.": "Dokument schließen? Deine Unterschrift geht dabei verloren.",
    "Das PDF konnte nicht erstellt werden. Bitte versuchen Sie es noch einmal.": "Das PDF konnte nicht erstellt werden. Bitte versuch es noch einmal.",
    "Ihr Name": "Dein Name",
    "Ihre Unterschrift": "Deine Unterschrift",
    "Mit „Übernehmen“ bestätigen Sie, dass dies Ihre Unterschrift ist. Damit unterschreiben Sie das Dokument elektronisch.": "Mit „Übernehmen“ bestätigst du, dass dies deine Unterschrift ist. Damit unterschreibst du das Dokument elektronisch.",
    "Bitte geben Sie Ihren Namen ein.": "Bitte gib deinen Namen ein.",
    "Bitte unterschreiben Sie im weißen Feld.": "Bitte unterschreib im weißen Feld.",
    "Zum Beispiel Ihr Name in Druckschrift": "Zum Beispiel dein Name in Druckschrift",
    "Schicken Sie das PDF jetzt an {who} zurück, am einfachsten per WhatsApp.": "Schick das PDF jetzt an {who} zurück, am einfachsten per WhatsApp.",
    "Schicken Sie das PDF jetzt zurück, am einfachsten per WhatsApp.": "Schick das PDF jetzt zurück, am einfachsten per WhatsApp.",
    "Im nächsten Schritt WhatsApp wählen und dann den Chat, aus dem Sie das Dokument bekommen haben.": "Im nächsten Schritt WhatsApp wählen und dann den Chat, aus dem du das Dokument bekommen hast.",
    "Speichern Sie das PDF und hängen Sie es in WhatsApp über die Büroklammer als „Dokument“ an.": "Speichere das PDF und häng es in WhatsApp über die Büroklammer als „Dokument“ an.",
    "Ende-zu-Ende verschlüsselt. Nur Sie und {who} können das Dokument lesen.": "Ende-zu-Ende verschlüsselt. Nur du und {who} könnt das Dokument lesen.",
    "Ende-zu-Ende verschlüsselt. Nur Sie und der Absender können das Dokument lesen.": "Ende-zu-Ende verschlüsselt. Nur du und der Absender könnt das Dokument lesen.",
    "Das unterschriebene Dokument geht automatisch an {who}. Sie müssen nichts zurückschicken.": "Das unterschriebene Dokument geht automatisch an {who}. Du musst nichts zurückschicken.",
    "Das unterschriebene Dokument geht automatisch an den Absender. Sie müssen nichts zurückschicken.": "Das unterschriebene Dokument geht automatisch an den Absender. Du musst nichts zurückschicken.",
    "Ihr unterschriebenes Dokument ist bei {who} angekommen. Sie müssen nichts mehr tun.": "Dein unterschriebenes Dokument ist bei {who} angekommen. Du musst nichts mehr tun.",
    "Ihr unterschriebenes Dokument ist beim Absender angekommen. Sie müssen nichts mehr tun.": "Dein unterschriebenes Dokument ist beim Absender angekommen. Du musst nichts mehr tun.",
    "Sie können die Seite jetzt schließen.": "Du kannst die Seite jetzt schließen.",
    "Das Senden hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es noch einmal.": "Das Senden hat nicht geklappt. Bitte prüf deine Internetverbindung und versuch es noch einmal.",
    "Der Link ist abgelaufen. Bitte schicken Sie das PDF per WhatsApp zurück.": "Der Link ist abgelaufen. Bitte schick das PDF per WhatsApp zurück.",
    "Für diesen Link wurde schon ein unterschriebenes Dokument übermittelt. Möchten Sie etwas ändern, schicken Sie das PDF bitte per WhatsApp.": "Für diesen Link wurde schon ein unterschriebenes Dokument übermittelt. Möchtest du etwas ändern, schick das PDF bitte per WhatsApp.",
    "Das Dokument ist zu groß zum Senden. Bitte schicken Sie das PDF per WhatsApp zurück.": "Das Dokument ist zu groß zum Senden. Bitte schick das PDF per WhatsApp zurück.",
    "Dieses Dokument wurde bereits unterschrieben und an {who} übermittelt. Sie müssen nichts mehr tun.": "Dieses Dokument wurde bereits unterschrieben und an {who} übermittelt. Du musst nichts mehr tun.",
    "Dieses Dokument wurde bereits unterschrieben und an den Absender übermittelt. Sie müssen nichts mehr tun.": "Dieses Dokument wurde bereits unterschrieben und an den Absender übermittelt. Du musst nichts mehr tun.",
    "<p><b>Ende-zu-Ende verschlüsselt.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt: Lesen können es nur Sie und der Absender.</p>": "<p><b>Ende-zu-Ende verschlüsselt.</b> Das PDF, dein Name und deine Unterschrift werden nur in deinem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt: Lesen können es nur du und der Absender.</p>",
    "<p><b>Dokumente per Link:</b> Das Dokument wurde auf dem Gerät des Absenders verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Wenn Sie auf „Fertig“ tippen, wird das unterschriebene Dokument auf Ihrem Gerät mit diesem Schlüssel verschlüsselt und für den Absender bereitgelegt. Danach wird das Original gelöscht. Das unterschriebene Dokument wird gelöscht, sobald der Absender es abgeholt hat, spätestens nach 30 Tagen. Nicht unterschriebene Dokumente werden nach 7 Tagen gelöscht.</p>": "<p><b>Dokumente per Link:</b> Das Dokument wurde auf dem Gerät des Absenders verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Wenn du auf „Fertig“ tippst, wird das unterschriebene Dokument auf deinem Gerät mit diesem Schlüssel verschlüsselt und für den Absender bereitgelegt. Danach wird das Original gelöscht. Das unterschriebene Dokument wird gelöscht, sobald der Absender es abgeholt hat, spätestens nach 30 Tagen. Nicht unterschriebene Dokumente werden nach 7 Tagen gelöscht.</p>",
    "Schreiben Sie kurz, was geändert werden soll. Die Nachricht geht an {who}. Unterschreiben müssen Sie dann noch nicht.": "Schreib kurz, was geändert werden soll. Die Nachricht geht an {who}. Unterschreiben musst du dann noch nicht.",
    "Bitte schreiben Sie kurz, was nicht stimmt.": "Bitte schreib kurz, was nicht stimmt.",
    "Danke! Ihre Nachricht ist verschlüsselt an {who} gegangen.": "Danke! Deine Nachricht ist verschlüsselt an {who} gegangen.",
    "Sie haben schon mehrere Nachrichten geschickt. Bitte schreiben Sie direkt per WhatsApp.": "Du hast schon mehrere Nachrichten geschickt. Bitte schreib direkt per WhatsApp.",
    "Senden hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung.": "Senden hat nicht geklappt. Bitte prüf deine Internetverbindung.",
    "Danke! Jetzt unterschreibt {name}. Bitte das Handy weitergeben.": "Danke! Jetzt unterschreibt {name}. Gib das Handy bitte weiter."
  };
  // Kundenseite in Du-Form (Albanisch, „ti“). Schlüssel = deutscher Sie-Text. Fehlt ein Eintrag, gilt SQ.
  const SQ_TI = {
    "Dokument unterschreiben": "Nënshkruaje dokumentin",
    "Danke! Sie können das Handy jetzt zurückgeben.": "Faleminderit! Tani mund ta kthesh telefonin.",
    "<p><b>Verschlüsselt.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt.</p>": "<p><b>I enkriptuar.</b> PDF-ja, emri dhe nënshkrimi yt përpunohen vetëm në shfletuesin tënd. Transmetohet vetëm dokumenti përfundimtar, dhe atë i enkriptuar.</p>",
    "Ihr Dokument steckt schon im Link. Sie müssen nichts speichern und nichts herunterladen.": "Dokumenti yt ndodhet tashmë në link. Nuk ke nevojë të ruash apo të shkarkosh asgjë.",
    "Unterschreiben Sie ein PDF direkt auf Ihrem Handy, ganz ohne Drucker.": "Nënshkruaj një PDF direkt në telefonin tënd, pa pasur nevojë për printer.",
    "Ende-zu-Ende verschlüsselt. Ihre Unterschrift wird nicht hochgeladen, und das Dokument wird nach dem Zurückschicken gelöscht.": "I enkriptuar nga skaji në skaj. Nënshkrimi yt nuk ngarkohet askund dhe dokumenti fshihet pasi ta kesh kthyer të nënshkruar.",
    "Ihr Dokument bleibt auf Ihrem Gerät. Es wird nichts hochgeladen und nichts gespeichert.": "Dokumenti yt mbetet në pajisjen tënde. Asgjë nuk ngarkohet dhe asgjë nuk ruhet.",
    "Dokument öffnen": "Hape dokumentin",
    "Mit dem Finger unterschreiben": "Nënshkruaj me gisht",
    "Danach schieben Sie die Unterschrift an die richtige Stelle.": "Pastaj e zhvendos nënshkrimin në vendin e duhur.",
    "Zurückschicken": "Ktheje dokumentin",
    "Das unterschriebene PDF direkt per WhatsApp senden.": "Dërgoje PDF-në e nënshkruar direkt me WhatsApp.",
    "PDF auswählen": "Zgjidh PDF-në",
    "Das Dokument, das Sie per WhatsApp oder E-Mail bekommen haben.": "Dokumentin që e ke marrë me WhatsApp ose me e-mail.",
    "<b>{who}</b> bittet Sie um Ihre Unterschrift.": "<b>{who}</b> të kërkon nënshkrimin tënd.",
    "Sie wurden gebeten, ein Dokument zu unterschreiben.": "Të është kërkuar të nënshkruash një dokument.",
    "Wählen Sie unten das PDF aus, das Sie bekommen haben.": "Zgjidh më poshtë PDF-në që ke marrë.",
    "So finden Sie das PDF auf dem iPhone": "Si ta gjesh PDF-në në iPhone",
    "In WhatsApp das PDF <b>antippen</b>.": "Në WhatsApp <b>prek</b> PDF-në.",
    "Auf <b>Teilen</b> tippen (Kästchen mit Pfeil) und <b>„In Dateien sichern“</b> wählen.": "Prek <b>„Teilen“</b> (katrori me shigjetë) dhe zgjidh <b>„In Dateien sichern“</b>.",
    "Hier auf <b>„PDF auswählen“</b> tippen, dann unter <b>„Zuletzt“</b> oder <b>„Durchsuchen“</b> das PDF antippen.": "Këtu prek <b>„Zgjidh PDF-në“</b>, pastaj te <b>„Zuletzt“</b> ose <b>„Durchsuchen“</b> prek PDF-në.",
    "So finden Sie das PDF auf Android": "Si ta gjesh PDF-në në Android",
    "In WhatsApp das PDF einmal <b>antippen</b>, damit es geladen ist.": "Në WhatsApp <b>prek</b> PDF-në një herë, që të shkarkohet.",
    "Hier auf <b>„PDF auswählen“</b> tippen.": "Këtu prek <b>„Zgjidh PDF-në“</b>.",
    "Unter <b>„Zuletzt“</b> oder <b>„Dokumente“</b> das PDF antippen. Es liegt meist im Ordner <b>„WhatsApp Documents“</b>.": "Te <b>„Zuletzt“</b> ose <b>„Dokumente“</b> prek PDF-në. Zakonisht ndodhet në dosjen <b>„WhatsApp Documents“</b>.",
    "Das PDF kam per E-Mail?": "PDF-ja të erdhi me e-mail?",
    "Speichern Sie den Anhang und wählen Sie ihn hier mit „PDF auswählen“ aus.": "Ruaje shtojcën dhe zgjidhe këtu me „Zgjidh PDF-në“.",
    "<p><b>Ihr Dokument bleibt auf Ihrem Gerät.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Nichts davon wird hochgeladen, gespeichert oder an Dritte übermittelt.</p>": "<p><b>Dokumenti yt mbetet në pajisjen tënde.</b> PDF-ja, emri dhe nënshkrimi yt përpunohen vetëm në shfletuesin tënd. Asgjë prej tyre nuk ngarkohet, nuk ruhet dhe nuk u jepet palëve të treta.</p>",
    "<p>Beim Aufruf der Seite verarbeitet der Hosting-Anbieter (Netlify) technisch notwendige Verbindungsdaten wie die IP-Adresse, um die Seite auszuliefern.</p>": "<p>Kur hap faqen, ofruesi i hostingut (Netlify) përpunon të dhënat teknike të lidhjes, si adresën IP, për ta shfaqur faqen.</p>",
    "<p><b>Dokumente per Link:</b> Schickt Ihnen jemand ein Dokument per Link, wurde es auf seinem Gerät verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Niemand außer Ihnen und dem Absender kann das Dokument lesen. Es wird gelöscht, sobald Sie es unterschrieben zurückgeschickt haben, spätestens nach 7 Tagen.</p>": "<p><b>Dokumente me link:</b> Nëse dikush të dërgon një dokument me link, ai është enkriptuar në pajisjen e tij dhe ruhet te Netlify vetëm i enkriptuar. Çelësi ndodhet vetëm në link (pas shenjës #) dhe nuk i dërgohet kurrë serverit. Askush përveç teje dhe dërguesit nuk mund ta lexojë dokumentin. Ai fshihet sapo ta kesh kthyer të nënshkruar, e më së voni pas 7 ditësh.</p>",
    "<p>Das unterschriebene PDF verschicken Sie selbst, zum Beispiel per WhatsApp. Dafür gelten die Datenschutzbestimmungen des jeweiligen Dienstes.</p>": "<p>PDF-në e nënshkruar e dërgon vetë, për shembull me WhatsApp. Për këtë vlejnë rregullat e privatësisë së shërbimit përkatës.</p>",
    "<p>Verantwortlich: siehe Impressum.</p>": "<p>Përgjegjësi: shih Impressum.</p>",
    "Dieser Link ist abgelaufen oder das Dokument wurde schon unterschrieben zurückgeschickt. Bitten Sie {who} um einen neuen Link.": "Ky link ka skaduar ose dokumenti është kthyer tashmë i nënshkruar. Kërko një link të ri nga {who}.",
    "Der Link ist unvollständig. Bitte öffnen Sie ihn noch einmal direkt aus WhatsApp.": "Linku është i paplotë. Të lutem hape edhe një herë direkt nga WhatsApp.",
    "Das Dokument konnte nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung.": "Dokumenti nuk mund të ngarkohej. Të lutem kontrollo lidhjen me internetin.",
    "Erneut versuchen": "Provo përsëri",
    "Haben Sie das PDF auf dem Handy? Dann können Sie es auch selbst auswählen.": "E ke PDF-në në telefon? Atëherë mund ta zgjedhësh edhe vetë.",
    "Diese Datei ist kein PDF. Bitte wählen Sie das PDF-Dokument aus.": "Ky skedar nuk është PDF. Të lutem zgjidh dokumentin PDF.",
    "Falsches Passwort. Bitte noch einmal eingeben:": "Fjalëkalim i gabuar. Të lutem shkruaje përsëri:",
    "Das PDF ist mit einem Passwort geschützt. Bitte Passwort eingeben:": "PDF-ja është e mbrojtur me fjalëkalim. Të lutem shkruaj fjalëkalimin:",
    "Die Seite wurde nicht vollständig geladen. Bitte laden Sie sie neu.": "Faqja nuk u ngarkua plotësisht. Të lutem ringarkoje.",
    "Dieses PDF passt nicht zur Anfrage (andere Seitenzahl). Bitte prüfen Sie, ob Sie das richtige Dokument gewählt haben. Sie können trotzdem unterschreiben und die Unterschrift selbst platzieren.": "Ky PDF nuk përputhet me kërkesën (numër tjetër faqesh). Të lutem kontrollo nëse ke zgjedhur dokumentin e duhur. Gjithsesi mund të nënshkruash dhe ta vendosësh nënshkrimin vetë.",
    "Dieses PDF ist nicht genau das angeforderte Dokument. Wählen Sie am besten das PDF aus der Nachricht. Sie können trotzdem unterschreiben.": "Ky PDF nuk është saktësisht dokumenti i kërkuar. Më mirë zgjidh PDF-në nga mesazhi. Gjithsesi mund të nënshkruash.",
    "Die gelb markierte Stelle wird nach dem Unterschreiben automatisch ausgefüllt.": "Vendi i shënuar me të verdhë plotësohet automatikisht pasi të nënshkruash.",
    "Die {n} gelb markierten Stellen werden nach dem Unterschreiben automatisch ausgefüllt.": "{n} vendet e shënuara me të verdhë plotësohen automatikisht pasi të nënshkruash.",
    "Die markierten Stellen sind ausgefüllt. Prüfen Sie kurz alles und tippen Sie dann auf „Fertig“.": "Vendet e shënuara u plotësuan. Kontrollo shkurt gjithçka dhe pastaj prek „Gati“.",
    "Hier unterschreiben": "Nënshkruaj këtu",
    "Ort und Datum einsetzen": "Vendos vendin dhe datën",
    "Jetzt unterschreiben": "Nënshkruaj tani",
    "Unterschreiben": "Nënshkruaj",
    "Unterschrift einsetzen": "Vendos nënshkrimin",
    "Fertig – PDF erstellen": "Gati – krijo PDF-në",
    "Hinzufügen": "Shto",
    "Entfernen": "Hiq",
    "Eingesetzt. Zum Verschieben ziehen.": "U vendos. Tërhiqe për ta zhvendosur.",
    "Unterschrift an {n} Stellen eingesetzt. Bitte kurz prüfen.": "Nënshkrimi u vendos në {n} vende. Të lutem kontrollo shkurt.",
    "Unterschrift eingesetzt. Bitte kurz prüfen.": "Nënshkrimi u vendos. Të lutem kontrollo shkurt.",
    "Schieben Sie die Unterschrift an die richtige Stelle. Größe ändern: blauen Punkt ziehen.": "Zhvendose nënshkrimin në vendin e duhur. Për madhësinë: tërhiq pikën blu.",
    "Zum Verschieben ziehen. Nochmal antippen zum Ändern.": "Tërhiqe për ta zhvendosur. Preke përsëri për ta ndryshuar.",
    "Bitte zuerst unterschreiben.": "Të lutem nënshkruaj fillimisht.",
    "Danke! Sie können die Seite jetzt schließen.": "Faleminderit! Tani mund ta mbyllësh faqen.",
    "Teilen hat nicht geklappt. Bitte „PDF speichern“ nutzen.": "Dërgimi nuk funksionoi. Të lutem përdor „Ruaj PDF-në“.",
    "Dokument schließen? Ihre Unterschrift geht dabei verloren.": "Ta mbyllësh dokumentin? Nënshkrimi yt do të humbasë.",
    "Das PDF konnte nicht erstellt werden. Bitte versuchen Sie es noch einmal.": "PDF-ja nuk mund të krijohej. Të lutem provo përsëri.",
    "Unterschrift ändern": "Ndrysho nënshkrimin",
    "Ihr Name": "Emri yt",
    "Ihre Unterschrift": "Nënshkrimi yt",
    "Löschen": "Fshij",
    "Hier mit dem Finger unterschreiben": "Nënshkruaj këtu me gisht",
    "Mit „Übernehmen“ bestätigen Sie, dass dies Ihre Unterschrift ist. Damit unterschreiben Sie das Dokument elektronisch.": "Me „Konfirmo“ vërteton se ky është nënshkrimi yt. Kështu e nënshkruan dokumentin në mënyrë elektronike.",
    "Bitte geben Sie Ihren Namen ein.": "Të lutem shkruaj emrin tënd.",
    "Bitte unterschreiben Sie im weißen Feld.": "Të lutem nënshkruaj në fushën e bardhë.",
    "Unterschrift einfügen": "Shto nënshkrimin",
    "Auf Seite {n}, dann an die Stelle schieben": "Në faqen {n}, pastaj zhvendose në vend",
    "Ort und Datum einfügen": "Shto vendin dhe datën",
    "Text einfügen": "Shto tekst",
    "Zum Beispiel Ihr Name in Druckschrift": "Për shembull emrin tënd me shkronja shtypi",
    "Unterschrift neu zeichnen": "Vizato nënshkrimin përsëri",
    "Text ändern": "Ndrysho tekstin",
    "Text eingeben": "Shkruaj tekstin",
    "Schicken Sie das PDF jetzt an {who} zurück, am einfachsten per WhatsApp.": "Tani dërgoje PDF-në te {who}, më së lehti me WhatsApp.",
    "Schicken Sie das PDF jetzt zurück, am einfachsten per WhatsApp.": "Tani ktheje PDF-në, më së lehti me WhatsApp.",
    "Per WhatsApp zurückschicken": "Dërgoje me WhatsApp",
    "Im nächsten Schritt WhatsApp wählen und dann den Chat mit {who}.": "Në hapin tjetër zgjidh WhatsApp dhe pastaj bisedën me {who}.",
    "Im nächsten Schritt WhatsApp wählen und dann den Chat, aus dem Sie das Dokument bekommen haben.": "Në hapin tjetër zgjidh WhatsApp dhe pastaj bisedën nga e cila e more dokumentin.",
    "Speichern Sie das PDF und hängen Sie es in WhatsApp über die Büroklammer als „Dokument“ an.": "Ruaje PDF-në dhe bashkëngjite në WhatsApp përmes kapëses si „Dokument“.",
    "PDF speichern": "Ruaj PDF-në",
    "Zurück zum Dokument": "Kthehu te dokumenti",
    "Ende-zu-Ende verschlüsselt. Nur Sie und {who} können das Dokument lesen.": "I enkriptuar nga skaji në skaj. Vetëm ti dhe {who} mund ta lexoni dokumentin.",
    "Ende-zu-Ende verschlüsselt. Nur Sie und der Absender können das Dokument lesen.": "I enkriptuar nga skaji në skaj. Vetëm ti dhe dërguesi mund ta lexoni dokumentin.",
    "Fertig tippen": "Prek „Gati“",
    "Das unterschriebene Dokument geht automatisch an {who}. Sie müssen nichts zurückschicken.": "Dokumenti i nënshkruar dërgohet automatikisht te {who}. Nuk ke nevojë ta kthesh vetë.",
    "Das unterschriebene Dokument geht automatisch an den Absender. Sie müssen nichts zurückschicken.": "Dokumenti i nënshkruar dërgohet automatikisht te dërguesi. Nuk ke nevojë ta kthesh vetë.",
    "Fertig – Dokument senden": "Gati – dërgo dokumentin",
    "Ihr unterschriebenes Dokument ist bei {who} angekommen. Sie müssen nichts mehr tun.": "Dokumenti yt i nënshkruar mbërriti te {who}. Nuk ke nevojë të bësh asgjë tjetër.",
    "Ihr unterschriebenes Dokument ist beim Absender angekommen. Sie müssen nichts mehr tun.": "Dokumenti yt i nënshkruar mbërriti te dërguesi. Nuk ke nevojë të bësh asgjë tjetër.",
    "Sie können die Seite jetzt schließen.": "Tani mund ta mbyllësh faqen.",
    "Kopie für mich speichern": "Ruaj një kopje për vete",
    "Das Senden hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es noch einmal.": "Dërgimi nuk funksionoi. Të lutem kontrollo lidhjen me internetin dhe provo përsëri.",
    "Der Link ist abgelaufen. Bitte schicken Sie das PDF per WhatsApp zurück.": "Linku ka skaduar. Të lutem dërgoje PDF-në me WhatsApp.",
    "Für diesen Link wurde schon ein unterschriebenes Dokument übermittelt. Möchten Sie etwas ändern, schicken Sie das PDF bitte per WhatsApp.": "Për këtë link është dërguar tashmë një dokument i nënshkruar. Nëse do të ndryshosh diçka, të lutem dërgoje PDF-në me WhatsApp.",
    "Das Dokument ist zu groß zum Senden. Bitte schicken Sie das PDF per WhatsApp zurück.": "Dokumenti është shumë i madh për t’u dërguar. Të lutem dërgoje PDF-në me WhatsApp.",
    "Erneut senden": "Dërgo përsëri",
    "Dieses Dokument wurde bereits unterschrieben und an {who} übermittelt. Sie müssen nichts mehr tun.": "Ky dokument është nënshkruar tashmë dhe është dërguar te {who}. Nuk ke nevojë të bësh asgjë tjetër.",
    "Dieses Dokument wurde bereits unterschrieben und an den Absender übermittelt. Sie müssen nichts mehr tun.": "Ky dokument është nënshkruar tashmë dhe është dërguar te dërguesi. Nuk ke nevojë të bësh asgjë tjetër.",
    "<p><b>Ende-zu-Ende verschlüsselt.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt: Lesen können es nur Sie und der Absender.</p>": "<p><b>I enkriptuar nga skaji në skaj.</b> PDF-ja, emri dhe nënshkrimi yt përpunohen vetëm në shfletuesin tënd. Transmetohet vetëm dokumenti përfundimtar, dhe atë i enkriptuar: mund ta lexoni vetëm ti dhe dërguesi.</p>",
    "<p><b>Dokumente per Link:</b> Das Dokument wurde auf dem Gerät des Absenders verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Wenn Sie auf „Fertig“ tippen, wird das unterschriebene Dokument auf Ihrem Gerät mit diesem Schlüssel verschlüsselt und für den Absender bereitgelegt. Danach wird das Original gelöscht. Das unterschriebene Dokument wird gelöscht, sobald der Absender es abgeholt hat, spätestens nach 30 Tagen. Nicht unterschriebene Dokumente werden nach 7 Tagen gelöscht.</p>": "<p><b>Dokumente me link:</b> Dokumenti është enkriptuar në pajisjen e dërguesit dhe ruhet te Netlify vetëm i enkriptuar. Çelësi ndodhet vetëm në link (pas shenjës #) dhe nuk i dërgohet kurrë serverit. Kur prek „Gati“, dokumenti i nënshkruar enkriptohet në pajisjen tënde me këtë çelës dhe i vihet në dispozicion dërguesit. Pastaj origjinali fshihet. Dokumenti i nënshkruar fshihet sapo dërguesi ta ketë marrë, e më së voni pas 30 ditësh. Dokumentet e panënshkruara fshihen pas 7 ditësh.</p>",
    "Dann nicht unterschreiben, sondern kurz Bescheid geben.": "Atëherë mos nënshkruaj, por njofto shkurt.",
    "Bescheid geben": "Njofto",
    "Nachricht senden": "Dërgo mesazhin",
    "Schreiben Sie kurz, was geändert werden soll. Die Nachricht geht an {who}. Unterschreiben müssen Sie dann noch nicht.": "Shkruaj shkurt se çfarë duhet ndryshuar. Mesazhi shkon te {who}. Atëherë nuk ke nevojë të nënshkruash ende.",
    "Bitte schreiben Sie kurz, was nicht stimmt.": "Të lutem shkruaj shkurt se çfarë nuk është në rregull.",
    "Danke! Ihre Nachricht ist verschlüsselt an {who} gegangen.": "Faleminderit! Mesazhi yt u dërgua i enkriptuar te {who}.",
    "Sie haben schon mehrere Nachrichten geschickt. Bitte schreiben Sie direkt per WhatsApp.": "Ke dërguar tashmë disa mesazhe. Të lutem shkruaj direkt në WhatsApp.",
    "Senden hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung.": "Dërgimi nuk funksionoi. Të lutem kontrollo lidhjen me internetin.",
    "Kurz Bescheid geben statt unterschreiben": "Njofto shkurt në vend që të nënshkruash",
    "Danke! Jetzt unterschreibt {name}. Bitte das Handy weitergeben.": "Faleminderit! Tani nënshkruan {name}. Të lutem ia jep telefonin."
  };
  // Übersetzung der Kundenseite (Deutsch mit „Sie“ = Schlüssel). Mit S.du in Du-Form.
  function tr(str, vars) {
    let out = str;
    if (S.lang === 'sq') out = (S.du && SQ_TI[str]) || SQ[str] || str;
    else if (S.du && DU[str]) out = DU[str];
    if (vars) Object.keys(vars).forEach(k => { out = out.split('{' + k + '}').join(vars[k]); });
    return out;
  }
  let uid = 1;
  const nid = () => 'o' + (uid++);
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  const svgI = (d, s, w) => '<svg viewBox="0 0 24 24" width="' + (s || 22) + '" height="' + (s || 22) + '" fill="none" stroke="currentColor" stroke-width="' + (w || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const I = {
    pen: svgI('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    penS: svgI('<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>', 14, 2.4),
    plus: svgI('<path d="M12 5v14M5 12h14"/>', 24, 2.2),
    check: svgI('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 22, 2.4),
    cal: svgI('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    calS: svgI('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>', 14, 2.4),
    text: svgI('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
    redo: svgI('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    info: svgI('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 20),
    warn: svgI('<path d="M12 3.5l9 16H3z"/><path d="M12 10v4M12 17h.01"/>', 20),
    x: svgI('<path d="M6 6l12 12M18 6L6 18"/>', 16, 2.6),
    share: svgI('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>'),
    copy: svgI('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 19),
    download: svgI('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>', 19),
    arrow: svgI('<path d="M5 12h14M13 6l6 6-6 6"/>', 20, 2.2),
    resize: svgI('<path d="M8 8l8 8"/><path d="M16 9.5V16H9.5"/>', 16, 2.6),
    checkL: svgI('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 40, 2.6),
    warnL: svgI('<path d="M12 7v6.5M12 17.2h.01"/>', 40, 2.8),
    clock: svgI('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 20),
    xc: svgI('<circle cx="12" cy="12" r="8.5"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>', 20),
    refresh: svgI('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', 20, 2.2),
    eye: svgI('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>', 20),
    bell: svgI('<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>', 20),
    mail: svgI('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.8 6.5 12 13l8.2-6.5"/>', 20),
    chev: svgI('<path d="M9 6l6 6-6 6"/>', 18, 2.2),
    doc: svgI('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5c1.2-1.6 2-2.9 2.6-2.6.6.3-.6 2.4 0 2.5.7.1 1.3-1.4 1.9-1.3.5.1 0 1.2.6 1.2.7 0 1.2-.6 1.9-.8"/>', 30, 1.8),
    docS: svgI('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5c1.2-1.6 2-2.9 2.6-2.6.6.3-.6 2.4 0 2.5.7.1 1.3-1.4 1.9-1.3.5.1 0 1.2.6 1.2.7 0 1.2-.6 1.9-.8"/>', 22, 1.9),
    search: svgI('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>', 19, 2.2),
    phone: svgI('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M9.5 15c1-1.6 1.7-2.8 2.3-2.5.6.3-.5 2.3.1 2.4.6.1 1.1-1.2 1.7-1.1.5.1 0 1 .6 1"/>', 20),
    link: svgI('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>', 20),
    tpl: svgI('<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h5"/><rect x="8" y="15" width="8" height="3" rx="1"/>', 20),
    save: svgI('<path d="M12 3v11"/><path d="M7.5 9.5 12 14l4.5-4.5"/><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/>', 20),
    restore: svgI('<path d="M12 14V3"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/>', 20)
  };

  /* ---------------- Zustand ---------------- */
  const S = {
    mode: 'sign',      // 'sign' = Kunde unterschreibt, 'send' = Absender markiert Stellen
    req: null,         // Anfrage aus dem Link (#r=…)
    file: null,        // { name, bytes, hash }
    pdf: null,         // pdf.js-Dokument
    pages: [],
    items: [],         // eingesetzte Unterschriften und Texte
    spots: [],         // markierte Stellen
    sig: null,         // übernommene Unterschrift
    name: '', ort: '',
    sel: null, cur: 0,
    out: null, dirty: false, inViewer: false, sheetOpen: false,
    hashMatch: null,
    remote: null,       // Kunde: Dokument aus dem Link { id, del, name, bytes, expires, deleted }
    fileIsRemote: false,
    lang: 'de',         // Sprache der Kundenseite: 'de' oder 'sq'
    du: false,          // Kundenseite duzt (aus dem Link)
    sendLang: 'de',     // Absender: gewählte Sprache für den Kunden
    sendDu: true,       // Absender: Kunden duzen
    server: null,       // Absender: { ok, pin, v } – gibt es den Server-Teil?
    sent: null,         // Absender: hochgeladenes Dokument { id, del, key, expires, track }
    sentBack: null,     // Kunde: Ergebnis der Rückgabe { ok, code, at }
    remoteSigned: null, // Kunde: Link wurde schon unterschrieben zurückgegeben { signedAt }
    view: null,         // Absender: angezeigtes unterschriebenes PDF (ID aus der Übersicht)
    inbox: { list: [], ok: true, err: '', last: 0, filter: 'all', q: '' },
    short: null,        // Kunde: Geheimnis aus einem kurzen Link (#xxxxxxxxxxxxxxxxxxxxxx)
    mail: false,        // Kunde: Der Absender bekommt zusätzlich eine Kopie per E-Mail
    mailErr: '',        // Absender: Kopie per E-Mail klappt gerade nicht (Fehlercode)
    intent: 'link',     // Absender: 'link' (per WhatsApp) oder 'local' (vor Ort auf diesem Handy)
    local: null,        // Vor-Ort-Unterschrift: { label, note, lang, du, saved }
    tpl: null,          // Absender: angewendete Vorlage { id, name, spots }
    own: [],            // Absender: eigene Unterschrift(en) als Vermittler, vor dem Senden ins PDF geschrieben
    mySig: null,        // Absender: gespeicherte eigene Unterschrift { path, bw, bh, sw }
    parts: [],          // Absender: Teile des Dokuments (mehrere PDFs zusammengefügt) { name, pages, sig, tpl }
    docTitle: '',       // Absender: Titel des Dokuments (sieht der Kunde, steht im Dateinamen); leer = aus dem Dateinamen
    sig2: null, name2: '' // Kunde: zweite Person (z. B. Ehepartner) mit eigener Unterschrift
  };
  const LS_PIN = 'firmio.pin.v1';
  const LS_FILTER = 'firmio.filter.v1';
  const DAY = 864e5;
  const LINK_PLACEHOLDER = '[Der Link wird beim Erstellen eingefügt]';
  let padMem = null, padMem2 = null;
  let io = null;
  let renderQueue = Promise.resolve();
  let installEvt = null;

  /* ---------------- Start ---------------- */
  function init() {
    const h = location.hash || '';
    if (/^#absender\b/i.test(h)) S.mode = 'send';
    S.short = S.mode === 'sign' ? shortSecret(h) : null;
    S.req = S.mode === 'sign' && !S.short ? parseReq(h) : null;
    if (S.short) $('#start').classList.add('pending'); // Sprache und Absender kommen erst mit den verschlüsselten Angaben
    S.lang = S.req && S.req.l === 'sq' ? 'sq' : 'de';
    S.du = !!(S.req && S.req.u === 1);
    applyStatic();
    setupStart();

    $('#file').addEventListener('change', onFile);
    if (S.mode === 'send') $('#file').multiple = true; // Absender: mehrere PDFs auf einmal (werden zusammengefügt)
    // Während die Dateiauswahl offen ist, nicht neu laden (siehe reloadIfIdle)
    $('#pickBtn').addEventListener('click', () => { picking = Date.now(); S.intent = 'link'; });
    $('#file').addEventListener('cancel', () => { picking = 0; });
    $('#localBtn').addEventListener('click', () => { picking = Date.now(); S.intent = 'local'; $('#file').click(); });
    $('#lhLink').addEventListener('click', () => openSettings());
    $('#ownBtn').addEventListener('click', () => placeOwnHere());
    if (S.mode === 'send') { $('#ownBtn').setAttribute('aria-label', 'Meine Unterschrift einsetzen'); $('#ownBtn').title = 'Meine Unterschrift einsetzen'; }
    $('#overBtn').addEventListener('click', () => { const id = S.local && S.local.saved; toStart(); if (id) openRecord(id); });
    $('#backBtn').addEventListener('click', () => history.back());
    $('#scrim').addEventListener('click', () => closeSheet());
    $('#shareBtn').addEventListener('click', shareResult);
    const retryBtn = $('#retryBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => { if (S.out && backMode()) sendBack(); });
    $('#dlBtn').addEventListener('click', () => { download(S.out.bytes, S.out.name); S.dirty = false; deleteRemote(); toast(tr('PDF wird gespeichert.')); });
    $('#editBtn').addEventListener('click', () => { showScreen('viewer'); renderBar(); requestAnimationFrame(relayout); });
    $('#newBtn').addEventListener('click', () => {
      if (S.dirty && !confirm(tr('Neues Dokument öffnen? Das unterschriebene PDF wurde noch nicht gesendet oder gespeichert.'))) return;
      toStart();
    });
    $('#pages').addEventListener('pointerdown', e => { if (!e.target.closest('.item, .spot.edit')) select(null); });

    window.addEventListener('hashchange', () => location.reload());
    window.addEventListener('resize', debounce(relayout, 140));
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstall(); });
    window.addEventListener('appinstalled', () => { installEvt = null; renderInstall(); toast('Firmio ist jetzt installiert.'); });
    // Nur im Absender-Modus: Service Worker für die App-Installation (Kunden bekommen keinen)
    if (S.mode === 'send' && 'serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker:', err));
    }
    if (S.short) loadShort();
    else if (S.req && S.req.d && S.req.k) loadRemote();
    if (S.mode === 'send') {
      const openM = /[#&]open=([A-Za-z0-9_-]{22})/.exec(h), filterM = /[#&]filter=(all|open|signed)\b/.exec(h);
      if (openM) pendingOpen = openM[1];
      if (filterM) { try { localStorage.setItem(LS_FILTER, filterM[1]); } catch (e) { /* egal */ } }
      if (openM || filterM) {
        try { history.replaceState(null, '', location.pathname + location.search + '#absender'); } catch (e) { /* egal */ }
      }
      const sb = $('#settingsBtn');
      if (sb) { sb.classList.remove('hidden'); sb.addEventListener('click', openSettings); }
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', e => {
          const d = e.data || {};
          if (S.inViewer) return;
          if (d.firmio === 'signed' || d.firmio === 'issue') refreshInbox();
          if (d.firmio === 'open') refreshInbox().then(() => { if (d.id) openRecord(d.id); else if (d.filter) setFilter(d.filter); });
        });
      }
      initInbox();
      keepPushAlive();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || S.mode !== 'send') return;
      checkUpdate();
      if (!S.inViewer) refreshInbox();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSheet();
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel && !S.sheetOpen && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); removeObj(S.sel);
      }
    });
  }

  // Kurzer Link: nur ein zufälliges Geheimnis (16 Byte) hinter dem #
  function shortSecret(h) {
    const m = /^#([A-Za-z0-9_-]{22})$/.exec(h);
    return m ? m[1] : null;
  }
  function parseReq(h) {
    const m = /(?:^#|&)r=([A-Za-z0-9_-]+)/.exec(h);
    if (!m) return null;
    try { return parseReqObj(JSON.parse(fromB64url(m[1]))); } catch (e) { return null; }
  }
  // Angaben zur Anfrage prüfen (aus einem langen Link oder aus den verschlüsselten Angaben eines kurzen Links)
  function parseReqObj(o) {
    try {
      if (!o || o.v !== 1) return null;
      // Stelle: [Art, Seite, x, y, Breite, Höhe] und optional 1 = zweite Person
      const s = Array.isArray(o.s) ? o.s.filter(a => Array.isArray(a) && (a.length === 6 || (a.length === 7 && (a[6] === 0 || a[6] === 1))) && (a[0] === 's' || a[0] === 'd') &&
        a.slice(1, 6).every(v => typeof v === 'number' && isFinite(v) && v >= 0)).slice(0, 40) : [];
      const line = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
      // Teile eines zusammengefügten Dokuments: [[Titel, Seiten], …]
      const q = Array.isArray(o.q) ? o.q.filter(x => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && Number.isInteger(x[1]) && x[1] > 0 && x[1] < 1000)
        .slice(0, 12).map(x => [line(x[0], 60) || 'Dokument', x[1]]) : [];
      return {
        h: typeof o.h === 'string' ? o.h.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 64) : '',
        p: typeof o.p === 'number' ? o.p : 0,
        s: s,
        f: typeof o.f === 'string' ? o.f.replace(/\s+/g, ' ').trim().slice(0, 60) : '',
        n: o.n === 0 ? 0 : 1,
        d: typeof o.d === 'string' && /^[A-Za-z0-9_-]{22}$/.test(o.d) ? o.d : '',
        k: typeof o.k === 'string' && /^[A-Za-z0-9_-]{43}$/.test(o.k) ? o.k : '',
        t: typeof o.t === 'string' && /^[A-Za-z0-9_-]{22}$/.test(o.t) ? o.t : '',
        l: o.l === 'sq' ? 'sq' : 'de',
        b: o.b === 1 ? 1 : 0,
        u: o.u === 1 ? 1 : 0,
        z: typeof o.z === 'string' ? o.z.replace(/\s+/g, ' ').trim().slice(0, 60) : '',
        c: typeof o.c === 'string' ? o.c.replace(/\s+/g, ' ').trim().slice(0, 80) : '',
        c2: line(o.c2, 80),     // Name der zweiten Person (vorausfüllen)
        ti: line(o.ti, 80),     // Titel des Dokuments (für Anzeige und Dateinamen)
        q: q.length > 1 ? q : []
      };
    } catch (e) { return null; }
  }
  function toB64url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // Link mit Dokument, dessen Rückgabe direkt an die Übersicht des Absenders geht
  const linkBack = () => !!(S.req && S.req.b && S.req.d && S.req.k && S.req.t);
  // … und das Dokument aus diesem Link ist gerade geöffnet
  const backMode = () => linkBack() && S.fileIsRemote && !!S.remote;

  function applyStatic() {
    document.documentElement.lang = S.lang;
    $('#stepsHead').textContent = tr('So geht’s');
    $('#pickLabel').textContent = tr('PDF auswählen');
    $('#backBtn').setAttribute('aria-label', tr('Zurück'));
    $('#doneTitle').textContent = tr('Fertig unterschrieben');
    $('#shareLabel').textContent = tr('Per WhatsApp zurückschicken');
    $('#dlLabel').textContent = tr('PDF speichern');
    $('#editBtn').textContent = tr('Zurück zum Dokument');
    $('#newBtn').textContent = tr('Neues Dokument');
    if ($('#retryLabel')) $('#retryLabel').textContent = tr('Erneut senden');
    $('#viewer').setAttribute('aria-label', tr('Dokument'));
  }

  function setLang(l) {
    S.lang = l === 'sq' ? 'sq' : 'de';
    applyStatic();
    setupStart();
    if (S.remoteSigned) renderRemoteSigned();
    else if (S.remote) renderRemoteReady();
  }

  function setText(sel, t) { const n = $(sel); if (n) n.textContent = t; }
  const STROKE = '<svg class="lh-stroke" viewBox="0 0 170 20" width="170" height="20" aria-hidden="true"><path d="M3 13.5c14-6 24-9.5 35-8.4 11 1.1 9.5 8.6 20 8.8 12 .2 15-9.4 28-9.6 13-.2 13 9 26 9.2 14 .2 22-6.6 38-7.4 7-.4 12 .4 16 1.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  // Füllfederhalter-Spitze (Briefkopf ohne eigenen Namen)
  const NIB = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21.2 6.7 12.1c-.4-.7-.3-1.6.3-2.1L9.1 8V3.6h5.8V8l2.1 2c.6.5.7 1.4.3 2.1z"/><path d="M12 21.2v-7.6"/><circle cx="12" cy="12.2" r="1.4"/><path d="M9.1 6.2h5.8"/></svg>';
  // Initialen für das Monogramm: „Max Mustermann“ → „MM“
  function initials(name) {
    let parts;
    try { parts = String(name).replace(/[^\p{L}\s-]/gu, ' ').trim().split(/[\s-]+/).filter(Boolean); } catch (e) { parts = String(name).trim().split(/\s+/); }
    if (!parts.length) return '';
    return (Array.from(parts[0])[0] + (parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : '')).toUpperCase();
  }
  function fillMono(node, name) {
    if (!node) return;
    node.innerHTML = '';
    if (!name || name === 'Firmio') node.innerHTML = NIB;
    else node.textContent = initials(name);
  }
  // Briefkopf: Absender (Kunde sieht den Namen aus dem Link, der Absender seinen eigenen)
  function renderLetterhead() {
    let name, sub;
    const send = S.mode === 'send';
    const p = send ? loadSender() : {};
    if (send) {
      name = p.name || 'Firmio';
      sub = p.name ? (p.sub || '') : 'Unterschriften per WhatsApp anfordern';
    } else if (S.req && S.req.f) {
      name = S.req.f;
      sub = S.req.z || '';
    } else if (CFG.anbieter) {
      name = CFG.anbieter;
      sub = tr('mit Firmio sicher unterschreiben');
    } else {
      name = 'Firmio';
      sub = tr('Dokumente sicher unterschreiben');
    }
    setText('#lhName', name);
    setText('#lhSub', sub);
    fillMono($('#lhMono'), name);
    const own = name !== 'Firmio';
    const mark = $('.appmark');
    if (mark) mark.style.visibility = own ? '' : 'hidden';
    const head = $('.apphead');
    if (head) head.classList.toggle('hidden', !own && !send);
    const link = $('#lhLink');
    if (link) link.classList.toggle('hidden', !send || !!p.name);
  }

  function setupStart() {
    const send = S.mode === 'send';
    renderLetterhead();
    $('#localBtn').classList.toggle('hidden', !send);
    document.title = (send ? 'Unterschrift anfordern' : tr('Dokument unterschreiben')) + ' · Firmio';
    $('#startTitle').textContent = send ? 'Unterschrift anfordern' : tr('Dokument unterschreiben');
    const inLink = !!(S.req && S.req.d && S.req.k);
    const nSigReq = S.req ? S.req.s.filter(a => a[0] === 's').length : 0;
    const lead = $('#startLead');
    if (send) {
      lead.textContent = 'Felder markieren, dann den Link per WhatsApp schicken oder direkt hier auf dem Handy unterschreiben lassen. Das unterschriebene PDF landet automatisch in Ihrer Übersicht.';
    } else if (S.req) {
      const who = S.req.f;
      const first = who ? tr('<b>{who}</b> bittet Sie um Ihre Unterschrift.', { who: esc(who) }) : esc(tr('Sie wurden gebeten, ein Dokument zu unterschreiben.'));
      const second = nSigReq ? (nSigReq === 1 ? tr('Die Stelle zum Unterschreiben ist schon markiert.') : tr('{n} Stellen zum Unterschreiben sind schon markiert.', { n: nSigReq }))
        : inLink ? tr('Ihr Dokument steckt schon im Link. Sie müssen nichts speichern und nichts herunterladen.') : tr('Wählen Sie unten das PDF aus, das Sie bekommen haben.');
      const pair = S.req.s.some(a => a[0] === 's' && a[6] === 1) ? ' ' + tr('Zwei Personen unterschreiben nacheinander.') : '';
      lead.innerHTML = first + ' ' + esc(second + pair);
    } else {
      lead.textContent = tr('Unterschreiben Sie ein PDF direkt auf Ihrem Handy, ganz ohne Drucker.');
    }
    const back = linkBack(), whoNom = S.req && S.req.f;
    $('#trustText').textContent = send
      ? 'Ende-zu-Ende verschlüsselt. Unterschriebene Dokumente werden nur auf diesem Gerät gespeichert.'
      : back && S.mail ? (whoNom ? tr('Verschlüsselt übertragen. Das unterschriebene Dokument geht direkt an {who}.', { who: whoNom }) : tr('Verschlüsselt übertragen. Das unterschriebene Dokument geht direkt an den Absender.'))
      : back ? (whoNom ? tr('Ende-zu-Ende verschlüsselt. Nur Sie und {who} können das Dokument lesen.', { who: whoNom }) : tr('Ende-zu-Ende verschlüsselt. Nur Sie und der Absender können das Dokument lesen.'))
        : inLink ? tr('Ende-zu-Ende verschlüsselt. Ihre Unterschrift wird nicht hochgeladen, und das Dokument wird nach dem Zurückschicken gelöscht.')
          : tr('Ihr Dokument bleibt auf Ihrem Gerät. Es wird nichts hochgeladen und nichts gespeichert.');

    const nSig = S.req ? S.req.s.filter(a => a[0] === 's').length : 0;
    const steps = send ? [
      ['PDF auswählen', 'Das Dokument, das Ihr Kunde unterschreiben soll.'],
      ['Stellen markieren', 'Felder für Unterschrift und Ort/Datum auf das Dokument ziehen. Wiederkehrende Formulare merkt sich Firmio als Vorlage.'],
      ['Senden oder vor Ort', 'Per WhatsApp-Link oder direkt hier auf dem Handy. Das unterschriebene PDF landet automatisch in Ihrer Übersicht.']
    ] : inLink ? [
      [tr('Dokument öffnen'), tr('Es ist schon im Link enthalten und öffnet sich von selbst.')],
      [tr('Mit dem Finger unterschreiben'), nSig ? tr('Die markierten Stellen werden automatisch ausgefüllt.') : tr('Danach schieben Sie die Unterschrift an die richtige Stelle.')],
      back ? [tr('Fertig tippen'), whoNom ? tr('Das unterschriebene Dokument geht automatisch an {who}. Sie müssen nichts zurückschicken.', { who: whoNom }) : tr('Das unterschriebene Dokument geht automatisch an den Absender. Sie müssen nichts zurückschicken.')]
        : [tr('Zurückschicken'), tr('Das unterschriebene PDF direkt per WhatsApp senden.')]
    ] : [
      [tr('PDF auswählen'), tr('Das Dokument, das Sie per WhatsApp oder E-Mail bekommen haben.')],
      [tr('Mit dem Finger unterschreiben'), nSig ? tr('Die markierten Stellen werden automatisch ausgefüllt.') : tr('Danach schieben Sie die Unterschrift an die richtige Stelle.')],
      [tr('Zurückschicken'), tr('Das unterschriebene PDF direkt per WhatsApp senden.')]
    ];
    const ol = $('#steps');
    ol.innerHTML = '';
    steps.forEach((s, i) => ol.append(el('li', null, el('span', { class: 'n', text: String(i + 1) }), el('div', null, el('b', { text: s[0] }), el('span', { text: s[1] })))));

    renderHelp(!send && !inLink);

    renderInstall();

    const links = $('#links');
    links.innerHTML = '';
    links.append(el('a', { href: '#', onclick: e => { e.preventDefault(); openInfo('ds'); }, text: tr('Datenschutz') }));
    if (CFG.impressum) links.append(el('a', { href: '#', onclick: e => { e.preventDefault(); openInfo('imp'); }, text: 'Impressum' }));
    links.append(send
      ? el('a', { href: '#', class: 'strong', text: 'Zur Unterschrift-Seite' })
      : el('a', { href: '#absender', text: tr('Für Absender: Unterschrift anfordern') }));
    if (!send) {
      links.append(el('span', { class: 'langsw' },
        el('a', { href: '#', class: S.lang === 'de' ? 'on' : null, 'aria-pressed': S.lang === 'de' ? 'true' : 'false', text: 'Deutsch', onclick: e => { e.preventDefault(); setLang('de'); } }),
        el('a', { href: '#', class: S.lang === 'sq' ? 'on' : null, 'aria-pressed': S.lang === 'sq' ? 'true' : 'false', lang: 'sq', text: 'Shqip', onclick: e => { e.preventDefault(); setLang('sq'); } })));
    }
  }

  function renderHelp(show) {
    const help = $('#helpBox');
    help.innerHTML = '';
    if (show) {
      const iosBox = helpDetails(tr('So finden Sie das PDF auf dem iPhone'), [
        tr('In WhatsApp das PDF <b>antippen</b>.'),
        tr('Auf <b>Teilen</b> tippen (Kästchen mit Pfeil) und <b>„In Dateien sichern“</b> wählen.'),
        tr('Hier auf <b>„PDF auswählen“</b> tippen, dann unter <b>„Zuletzt“</b> oder <b>„Durchsuchen“</b> das PDF antippen.')
      ], isIOS);
      const andBox = helpDetails(tr('So finden Sie das PDF auf Android'), [
        tr('In WhatsApp das PDF einmal <b>antippen</b>, damit es geladen ist.'),
        tr('Hier auf <b>„PDF auswählen“</b> tippen.'),
        tr('Unter <b>„Zuletzt“</b> oder <b>„Dokumente“</b> das PDF antippen. Es liegt meist im Ordner <b>„WhatsApp Documents“</b>.')
      ], isAndroid);
      if (isAndroid) help.append(andBox, iosBox); else help.append(iosBox, andBox);
      if (!isIOS && !isAndroid) {
        help.append(el('details', { class: 'help' }, el('summary', { text: tr('Das PDF kam per E-Mail?') }),
          el('p', { class: 'tip', text: tr('Speichern Sie den Anhang und wählen Sie ihn hier mit „PDF auswählen“ aus.') })));
      }
    }
  }

  function helpDetails(title, items, open) {
    return el('details', { class: 'help', open: open || null },
      el('summary', { text: title }),
      el('ol', { html: items.map(t => '<li>' + t + '</li>').join('') }));
  }

  function renderInstall() {
    const box = $('#installBox');
    if (!box) return;
    box.innerHTML = '';
    if (S.mode !== 'send') return;
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    if (standalone) return;
    if (installEvt) {
      box.append(el('div', { class: 'install' },
        el('img', { src: 'icons/icon-192.png', alt: '', width: '42', height: '42' }),
        el('div', { class: 'grow' }, el('b', { text: 'Firmio als App' }), el('span', { text: 'Direkt vom Startbildschirm öffnen' })),
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Installieren', onclick: async () => {
          const ev = installEvt;
          installEvt = null;
          try { ev.prompt(); await ev.userChoice; } catch (e) { /* egal */ }
          renderInstall();
        } })));
    } else if (isIOS) {
      box.append(el('div', { class: 'install' },
        el('img', { src: 'icons/icon-192.png', alt: '', width: '42', height: '42' }),
        el('div', { class: 'grow', html: '<b>Firmio als App</b><span>Unten auf <b>Teilen</b> tippen, dann <b>„Zum Home-Bildschirm“</b>. Danach immer aus der App senden, dann bleibt Ihre Übersicht vollständig.</span>' })));
    }
  }

  function openInfo(kind) {
    if (kind === 'imp') {
      openSheet('Impressum', el('div', { class: 'prose pre', text: CFG.impressum }));
      return;
    }
    const back = linkBack() || S.mode === 'send';
    const mailOn = S.mode === 'send' ? !!(S.server && S.server.mail) : S.mail;
    const body = CFG.datenschutz
      ? el('div', { class: 'prose pre', text: CFG.datenschutz })
      : el('div', { class: 'prose', html:
        (back && mailOn ? tr('<p><b>Verschlüsselt.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt.</p>')
          : back ? tr('<p><b>Ende-zu-Ende verschlüsselt.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt: Lesen können es nur Sie und der Absender.</p>')
          : tr('<p><b>Ihr Dokument bleibt auf Ihrem Gerät.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Nichts davon wird hochgeladen, gespeichert oder an Dritte übermittelt.</p>')) +
        tr('<p>Diese Seite verwendet keine Cookies, kein Tracking und keine Analysedienste. Sie ist technisch so eingestellt, dass sie keine Daten an fremde Server senden kann.</p>') +
        tr('<p>Beim Aufruf der Seite verarbeitet der Hosting-Anbieter (Netlify) technisch notwendige Verbindungsdaten wie die IP-Adresse, um die Seite auszuliefern.</p>') +
        (back ? tr('<p><b>Dokumente per Link:</b> Das Dokument wurde auf dem Gerät des Absenders verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Wenn Sie auf „Fertig“ tippen, wird das unterschriebene Dokument auf Ihrem Gerät mit diesem Schlüssel verschlüsselt und für den Absender bereitgelegt. Danach wird das Original gelöscht. Das unterschriebene Dokument wird gelöscht, sobald der Absender es abgeholt hat, spätestens nach 30 Tagen. Nicht unterschriebene Dokumente werden nach 7 Tagen gelöscht.</p>')
          : tr('<p><b>Dokumente per Link:</b> Schickt Ihnen jemand ein Dokument per Link, wurde es auf seinem Gerät verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Niemand außer Ihnen und dem Absender kann das Dokument lesen. Es wird gelöscht, sobald Sie es unterschrieben zurückgeschickt haben, spätestens nach 7 Tagen.</p>') +
            tr('<p>Das unterschriebene PDF verschicken Sie selbst, zum Beispiel per WhatsApp. Dafür gelten die Datenschutzbestimmungen des jeweiligen Dienstes.</p>')) +
        (back ? tr('<p><b>Geöffnet und Rückmeldungen:</b> Beim ersten Öffnen des Links merkt sich der Server nur den Zeitpunkt (ohne Namen oder Inhalte), damit der Absender sieht, dass das Dokument angekommen ist. Eine Nachricht über „Stimmt etwas nicht?“ wird wie das Dokument Ende-zu-Ende verschlüsselt und gelöscht, sobald der Absender sie abgeholt hat.</p>') : '') +
        (back && mailOn ? tr('<p><b>Kopie per E-Mail:</b> Der Absender bekommt das unterschriebene Dokument zusätzlich per E-Mail. Dafür wird es verschlüsselt (TLS) an den Server übertragen und von dort per E-Mail an den Absender geschickt. Der Server speichert diese Kopie nicht.</p>') : '') +
        (S.mode === 'send' && mailOn ? '<p>Die Mails gehen über Ihr eigenes E-Mail-Konto; dort liegt jeweils eine Kopie unter „Gesendet“.</p>' : '') +
        (S.mode === 'send' ? '<p><b>Ihre Übersicht</b> (Kundennotizen, Schlüssel und unterschriebene PDFs) wird nur auf diesem Gerät gespeichert. Unterschriebene Dokumente werden vom Server gelöscht, sobald Firmio sie abgeholt hat. Vor Ort unterschriebene Dokumente werden gar nicht hochgeladen.</p>' +
          '<p><b>Vorlagen</b> merken sich nur, wo die Felder liegen, und zum Wiedererkennen kurze Prüfsummen der Wörter – keinen Text und keine Kundendaten. <b>Ihre gespeicherte Unterschrift</b> liegt nur auf diesem Gerät; ins Dokument kommt sie erst, wenn Sie senden. <b>Sicherungen</b> erstellen Sie selbst als Datei; wo Sie sie ablegen, entscheiden Sie.</p>' +
          '<p><b>Erinnerungen:</b> Der Server merkt sich nur, zu welchen zufälligen Kennungen er schon erinnert hat. Die Benachrichtigung enthält keine Namen; die setzt Ihr Handy selbst ein.</p>' : '') +
        (CFG.impressum ? tr('<p>Verantwortlich: siehe Impressum.</p>') : '') });
    openSheet(tr('Datenschutz'), body);
  }

  function showScreen(name) {
    ['start', 'viewer', 'done'].forEach(id => $('#' + id).classList.toggle('hidden', id !== name));
    $('#toast').classList.remove('on');
  }

  /* ---------------- PDF öffnen ---------------- */
  function readFile(f) {
    if (f.arrayBuffer) return f.arrayBuffer().then(b => new Uint8Array(b));
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(new Uint8Array(r.result));
      r.onerror = () => rej(r.error);
      r.readAsArrayBuffer(f);
    });
  }
  function blobBytes(b) {
    if (b.arrayBuffer) return b.arrayBuffer().then(x => new Uint8Array(x));
    return readFile(b);
  }
  function looksLikePdf(bytes) {
    const n = Math.min(bytes.length, 1024);
    for (let i = 0; i < n - 4; i++) {
      if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46) return true;
    }
    return false;
  }
  async function sha256(bytes) {
    try {
      if (!window.crypto || !crypto.subtle) return '';
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      let s = '';
      for (let i = 0; i < h.length; i++) s += (h[i] < 16 ? '0' : '') + h[i].toString(16);
      return s;
    } catch (e) { return ''; }
  }
  function cleanName(n) {
    n = String(n || '').split(/[\\/]/).pop().trim();
    if (!n) n = 'Dokument.pdf';
    if (!/\.pdf$/i.test(n)) n += '.pdf';
    return n;
  }

  async function onFile(e) {
    picking = 0;
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    if (S.mode === 'send' && files.length > 1) { await openMany(files); return; } // mehrere PDFs: zu einem Dokument
    const f = files[0];
    let bytes;
    try { bytes = await readFile(f); } catch (err) { alert(tr('Die Datei konnte nicht gelesen werden.')); return; }
    await openBytes(bytes, f.name, false);
  }

  // parts (Absender): Teile, wenn mehrere PDFs zu einem Dokument zusammengefügt wurden
  async function openBytes(bytes, name, fromLink, parts) {
    busy(tr('Dokument wird geöffnet …'));
    try {
      if (!looksLikePdf(bytes)) {
        unbusy();
        alert(tr('Diese Datei ist kein PDF. Bitte wählen Sie das PDF-Dokument aus.'));
        return false;
      }
      const pdf = await loadPdfJs(bytes);
      const hash = await sha256(bytes);
      if (S.pdf) { try { S.pdf.destroy(); } catch (x) { /* egal */ } }
      S.file = { name: cleanName(name), bytes: bytes, hash: hash };
      S.fileIsRemote = !!fromLink;
      S.pdf = pdf;
      S.parts = parts && parts.length ? parts : [{ name: S.file.name, pages: pdf.numPages, sig: null, tpl: null }];
      await openViewer();
      loadPdfLib().catch(() => {});
    } catch (err) {
      console.error(err);
      unbusy();
      alert(err && err.message === 'pdfjs'
        ? tr('Die Seite wurde nicht vollständig geladen. Bitte laden Sie sie neu.')
        : tr('Das PDF konnte nicht geöffnet werden. Ist die Datei vollständig heruntergeladen?'));
      return false;
    }
    unbusy();
    return true;
  }

  /* ---------------- Server: verschlüsselte Dokumente ---------------- */
  async function apiFetch(method, path, opt) {
    opt = opt || {};
    const headers = {};
    let body;
    if (opt.pin) headers['x-firmio-pin'] = opt.pin;
    if (opt.del) headers['x-firmio-del'] = opt.del;
    if (opt.json) { headers['content-type'] = 'application/json'; body = JSON.stringify(opt.json); }
    else if (opt.body) { headers['content-type'] = 'application/octet-stream'; body = opt.body; }
    let res;
    try {
      res = await fetch(path, { method: method, headers: headers, body: body, cache: 'no-store', credentials: 'omit' });
    } catch (e) {
      const err = new Error('offline'); err.code = 'offline'; throw err;
    }
    if (!res.ok) {
      let code = 'http_' + res.status;
      try { const j = await res.json(); if (j && j.error) code = j.error; } catch (x) { /* kein JSON */ }
      const err = new Error(code); err.code = code; err.status = res.status; throw err;
    }
    return res;
  }
  const apiJSON = async (method, path, opt) => (await apiFetch(method, path, opt)).json();

  function bytesToB64url(b) {
    let bin = '';
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Base64 (normal) für größere Daten, in Stücken (schnell, ohne Stack-Überlauf)
  function bytesToB64(b) {
    let bin = '';
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const MAIL_MAX = 3 * 1024 * 1024; // größer: Mail ohne Anhang (Hinweis), das PDF liegt in der Übersicht
  function concatBytes(list) {
    let n = 0;
    list.forEach(b => { n += b.length; });
    const out = new Uint8Array(n);
    let o = 0;
    list.forEach(b => { out.set(b, o); o += b.length; });
    return out;
  }
  const MAGIC = [70, 73, 82, 77, 49]; // "FIRM1"

  // Dokument + Kopfdaten verpacken und mit AES-GCM verschlüsseln (neuer Zufalls-IV pro Aufruf)
  async function sealDoc(bytes, head, keyBytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const h = new TextEncoder().encode(JSON.stringify(head));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, h.length);
    const plain = concatBytes([new Uint8Array(MAGIC), len, h, bytes]);
    const ck = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, ck, plain));
    return concatBytes([iv, ct]);
  }
  // Neues Dokument: neuer Schlüssel, der nur im Link steht
  async function encryptDoc(bytes, name) {
    const key = crypto.getRandomValues(new Uint8Array(32));
    return { key: bytesToB64url(key), payload: await sealDoc(bytes, { name: name }, key) };
  }
  async function decryptDoc(payload, keyB64) {
    const ck = await crypto.subtle.importKey('raw', b64urlToBytes(keyB64), 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(0, 12) }, ck, payload.subarray(12)));
    for (let i = 0; i < MAGIC.length; i++) if (plain[i] !== MAGIC[i]) throw new Error('format');
    const hl = new DataView(plain.buffer, plain.byteOffset + 5, 4).getUint32(0);
    const head = JSON.parse(new TextDecoder().decode(plain.subarray(9, 9 + hl)));
    return { name: String(head.name || 'Dokument.pdf'), bytes: plain.slice(9 + hl), head: head && typeof head === 'object' ? head : {} };
  }
  // Kurzer Link: Aus dem Geheimnis werden im Browser abgeleitet: Kennung beim Server, Schlüssel und Rückgabe-Token.
  // Der Server bekommt nur die Kennung und die Prüfsumme des Tokens – nie das Geheimnis oder den Schlüssel.
  async function deriveLink(secret) {
    const base = await crypto.subtle.importKey('raw', b64urlToBytes(secret), 'HKDF', false, ['deriveBits']);
    const salt = new TextEncoder().encode('firmio');
    const bits = async (info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: new TextEncoder().encode(info) }, base, n * 8));
    return { id: bytesToB64url(await bits('id', 16)), key: bytesToB64url(await bits('key', 32)), tok: bytesToB64url(await bits('tok', 16)) };
  }
  async function sealHead(obj, keyB64) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ck = await crypto.subtle.importKey('raw', b64urlToBytes(keyB64), 'AES-GCM', false, ['encrypt']);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, ck, new TextEncoder().encode(JSON.stringify(obj))));
    return bytesToB64url(concatBytes([iv, ct]));
  }
  async function openHead(str, keyB64) {
    const data = b64urlToBytes(str);
    const ck = await crypto.subtle.importKey('raw', b64urlToBytes(keyB64), 'AES-GCM', false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, ck, data.subarray(12));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  const shortLinks = () => !!(S.server && S.server.v >= 4 && window.crypto && crypto.subtle);

  // Mehrere Versuche bei Funklöchern (nicht bei klaren Ablehnungen des Servers)
  async function apiRetry(method, path, opt, tries) {
    for (let i = 1; ; i++) {
      try { return await apiFetch(method, path, opt); } catch (e) {
        const temp = e.code === 'offline' || (e.status >= 500 && e.status !== 501);
        if (!temp || i >= (tries || 3)) throw e;
        await new Promise(r => setTimeout(r, 700 * i));
      }
    }
  }

  async function uploadDoc(pin, onProgress, info) {
    const CH = 3 * 1024 * 1024;
    const putParts = async (id, payload) => {
      const chunks = Math.ceil(payload.length / CH);
      for (let i = 0; i < chunks; i++) {
        await apiRetry('PUT', '/api/doc/' + id + '/' + i, { pin: pin, body: new Blob([payload.slice(i * CH, (i + 1) * CH)]) });
        if (onProgress) onProgress((i + 1) / chunks);
      }
    };
    if (info && shortLinks()) {
      // Kurzer Link: Geheimnis würfeln, alles daraus ableiten, Angaben verschlüsselt mitschicken
      for (let attempt = 0; attempt < 2; attempt++) {
        const secret = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
        const d = await deriveLink(secret);
        const payload = await sealDoc(S.file.bytes, { name: S.file.name }, b64urlToBytes(d.key));
        const head = await sealHead(info, d.key);
        const tok = await sha256(new TextEncoder().encode(d.tok));
        let created;
        try {
          created = await apiJSON('POST', '/api/doc', { pin: pin, json: { size: payload.length, chunks: Math.ceil(payload.length / CH), id: d.id, tok: tok, head: head } });
        } catch (e) { if (e.code === 'exists' && attempt === 0) continue; throw e; }
        await putParts(d.id, payload);
        return { id: d.id, del: d.tok, key: d.key, secret: secret, expires: created.expires, hash: S.file.hash, headSig: JSON.stringify(info) };
      }
    }
    const enc = await encryptDoc(S.file.bytes, S.file.name);
    const created = await apiJSON('POST', '/api/doc', { pin: pin, json: { size: enc.payload.length, chunks: Math.ceil(enc.payload.length / CH) } });
    await putParts(created.id, enc.payload);
    return { id: created.id, del: created.del, key: enc.key, expires: created.expires, hash: S.file.hash };
  }

  async function serverStatus() {
    if (S.server && S.server.ok) return S.server;
    try {
      const ctl = window.AbortController ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 5000) : 0;
      const res = await fetch('/api/status', { cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined });
      clearTimeout(timer);
      const j = res.ok ? await res.json() : null;
      S.server = j && j.ok ? { ok: true, pin: !!j.pin, v: Number(j.v) || 1, push: !!j.push, mail: !!j.mail } : { ok: false };
    } catch (e) { S.server = { ok: false }; }
    return S.server;
  }
  function getPin() { try { return localStorage.getItem(LS_PIN) || ''; } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(LS_PIN, v); else localStorage.removeItem(LS_PIN); } catch (e) { /* egal */ } }

  // Kunde: kurzer Link – erst die verschlüsselten Angaben (Absender, Sprache, Stellen), dann das Dokument
  async function loadShort() {
    const box = $('#remoteBox');
    $('#pickBtn').classList.add('hidden');
    box.innerHTML = '';
    box.append(el('div', { class: 'remote waiting' }, el('div', { class: 'spin sm' })));
    let meta = null;
    try {
      const d = await deriveLink(S.short);
      meta = await apiJSON('GET', '/api/doc/' + d.id);
      let info = null;
      try { info = meta.head ? parseReqObj(await openHead(meta.head, d.key)) : null; } catch (e) { info = null; }
      S.req = Object.assign(info || parseReqObj({ v: 1 }), { d: d.id, k: d.key, t: d.tok });
      if (!info) S.req.b = 1;
      S.lang = S.req.l === 'sq' ? 'sq' : 'de';
      S.du = S.req.u === 1;
      S.mail = !!meta.mail;
    } catch (e) {
      console.warn('Kurzer Link:', e);
      $('#start').classList.remove('pending');
      applyStatic();
      setupStart();
      renderRemoteError(e && e.code);
      return;
    }
    $('#start').classList.remove('pending');
    applyStatic();
    setupStart();
    await loadRemote(meta);
  }
  const retryLoad = () => (S.short && !(S.req && S.req.d) ? loadShort() : loadRemote());

  // Kunde: Dokument aus dem Link laden
  async function loadRemote(known) {
    const r = S.req;
    const box = $('#remoteBox');
    $('#pickBtn').classList.add('hidden');
    const fill = el('i');
    box.innerHTML = '';
    box.append(el('div', { class: 'remote' },
      el('div', { class: 'spin sm' }),
      el('div', { class: 'grow' }, el('b', { text: tr('Dokument wird geladen …') }), el('div', { class: 'prog' }, fill))));
    try {
      const meta = known || await apiJSON('GET', '/api/doc/' + r.d);
      if (!!meta.mail !== S.mail) { S.mail = !!meta.mail; setupStart(); } // Datenschutzhinweis passend zur Mail-Kopie
      if (meta.status === 'signed') { S.remoteSigned = { signedAt: meta.signedAt }; renderRemoteSigned(); return; }
      const parts = [];
      for (let i = 0; i < meta.chunks; i++) {
        const res = await apiFetch('GET', '/api/doc/' + r.d + '/' + i);
        parts.push(new Uint8Array(await res.arrayBuffer()));
        fill.style.width = Math.round((i + 1) / meta.chunks * 100) + '%';
      }
      let doc;
      try { doc = await decryptDoc(concatBytes(parts), r.k); } catch (e) { const err = new Error('key'); err.code = 'key'; throw err; }
      S.remote = { id: r.d, del: r.t, name: cleanName(doc.name), bytes: doc.bytes, expires: meta.expires, deleted: false };
      markOpened();
      renderRemoteReady();
      await openBytes(doc.bytes, S.remote.name, true);
    } catch (e) {
      console.warn('Dokument aus dem Link:', e);
      if (e && e.code === 'signed') { S.remoteSigned = { signedAt: 0 }; renderRemoteSigned(); return; }
      renderRemoteError(e && e.code);
    }
  }

  // Kunde: Dieser Link wurde schon unterschrieben zurückgegeben
  function renderRemoteSigned() {
    const box = $('#remoteBox');
    const who = S.req && S.req.f;
    const at = S.remoteSigned && S.remoteSigned.signedAt ? new Date(S.remoteSigned.signedAt) : null;
    box.innerHTML = '';
    ['#pickBtn', '#reqCard', '#stepsHead', '#steps'].forEach(s => $(s).classList.add('hidden'));
    $('#helpBox').innerHTML = '';
    $('#startTitle').textContent = tr('Bereits unterschrieben');
    document.title = tr('Bereits unterschrieben') + ' · Firmio';
    $('#startLead').textContent = who ? tr('Dieses Dokument wurde bereits unterschrieben und an {who} übermittelt. Sie müssen nichts mehr tun.', { who: who })
      : tr('Dieses Dokument wurde bereits unterschrieben und an den Absender übermittelt. Sie müssen nichts mehr tun.');
    box.append(el('div', { class: 'remote ok' },
      el('div', { class: 'okmark sm', html: I.check }),
      el('div', { class: 'grow' },
        el('b', { text: (S.req && S.req.ti) || (S.remote && S.remote.name) || tr('Dokument') }),
        el('p', { text: at ? tr('Unterschrieben am {date} um {time} Uhr.', { date: fmtDate(at), time: fmtTime(at) }) : tr('Bereits unterschrieben') }))));
  }

  function renderRemoteReady() {
    const box = $('#remoteBox');
    box.innerHTML = '';
    $('#pickBtn').classList.add('hidden');
    const n = S.req && S.req.p ? S.req.p : 0, nq = S.req && S.req.q ? S.req.q.length : 0;
    const info = (nq > 1 ? tr('{n} Dokumente', { n: nq }) + ' · ' : '') + (n ? (n === 1 ? tr('1 Seite') : tr('{n} Seiten', { n: n })) + ' · ' : '') + tr('gültig bis {date}', { date: fmtDate(new Date(S.remote.expires)) });
    box.append(
      el('div', { class: 'doccard' }, el('span', { class: 'ic', html: I.docS }), el('div', null, el('b', { text: (S.req && S.req.ti) || S.remote.name }), el('span', { text: info }))),
      el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.pen + '<span>' + tr('Dokument öffnen') + '</span>',
        onclick: () => openBytes(S.remote.bytes, S.remote.name, true) }));
  }

  function renderRemoteError(code) {
    const box = $('#remoteBox');
    const who = S.req && S.req.f;
    const text = code === 'not_found' || code === 'expired' || code === 'http_404' || code === 'http_410'
      ? tr('Dieser Link ist abgelaufen oder das Dokument wurde schon unterschrieben zurückgeschickt. Bitten Sie {who} um einen neuen Link.', { who: who || tr('den Absender') })
      : code === 'key' ? tr('Der Link ist unvollständig. Bitte öffnen Sie ihn noch einmal direkt aus WhatsApp.')
        : tr('Das Dokument konnte nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung.');
    box.innerHTML = '';
    const card = el('div', { class: 'banner warn' }, el('span', { html: I.warn }), el('p', { text: text }));
    box.append(card);
    if (code !== 'not_found' && code !== 'expired' && code !== 'http_404' && code !== 'http_410' && code !== 'key') {
      box.append(el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', text: tr('Erneut versuchen'), onclick: () => retryLoad() }));
    }
    box.append(el('p', { class: 'hint', text: tr('Haben Sie das PDF auf dem Handy? Dann können Sie es auch selbst auswählen.') }));
    const pick = $('#pickBtn');
    pick.classList.remove('hidden');
    pick.classList.remove('btn-primary');
    pick.classList.add('btn-ghost');
    renderHelp(true);
  }

  // Dem Absender zeigen, dass der Link angekommen ist: Der Server merkt sich nur den ersten Zeitpunkt.
  // Nicht bei „Link als Kunde testen“ (…?vorschau=1#…) und nicht ohne Rückgabe an die Übersicht.
  function markOpened() {
    if (!linkBack() || /[?&]vorschau\b/.test(location.search)) return;
    apiFetch('POST', '/api/doc/' + encodeURIComponent(S.req.d) + '/opened', { del: S.req.t, json: {} }).catch(() => {});
  }
  const previewLink = link => String(link).replace('#', '?vorschau=1#');

  function deleteRemote() {
    const r = S.remote;
    if (!S.fileIsRemote || !r || r.deleted || !r.del || backMode()) return;
    r.deleted = true;
    apiFetch('DELETE', '/api/doc/' + r.id, { del: r.del }).catch(e => { r.deleted = false; console.warn('Löschen:', e); });
  }

  let pdfLibP = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!pdfLibP) {
      pdfLibP = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'vendor/pdf-lib.min.js';
        s.onload = () => window.PDFLib ? res(window.PDFLib) : rej(new Error('pdf-lib fehlt'));
        s.onerror = () => { pdfLibP = null; rej(new Error('pdf-lib konnte nicht geladen werden')); };
        document.head.appendChild(s);
      });
    }
    return pdfLibP;
  }

  /* ---------------- Ansicht ---------------- */
  async function openViewer() {
    S.items = []; S.spots = []; S.sel = null; S.out = null; S.dirty = false; S.hashMatch = null; S.cur = 0; S.sig = null; S.sent = null; S.sendLang = 'de'; S.sendDu = loadSender().du !== false; S.sentBack = null; S.custLabel = ''; S.custLabel2 = ''; S.custNote = ''; S.custGuess = null; S.custGuessP = null; S.tpl = null; S.docSig = null;
    S.own = []; S.ownBurned = 0; S.ownAuto = null; S.mySig = S.mode === 'send' ? loadMySig() : null;
    S.sig2 = null; S.docTitle = '';
    $('#ownBtn').classList.toggle('hidden', !(S.mode === 'send' && !S.view));
    showScreen('viewer');
    $('#docName').textContent = S.mode === 'sign' && S.req && S.req.ti ? S.req.ti : S.mode === 'send' && !S.view ? docNameText() : S.file.name;
    $('#modeChip').textContent = S.view ? 'Unterschrieben' : S.mode === 'send' ? (S.intent === 'local' ? 'Vor Ort' : 'Anfordern') : '';
    await buildPages();
    if (S.view) {
      // nur ansehen
    } else if (S.mode === 'send') {
      banner('info', S.intent === 'local'
        ? 'Markieren Sie mit „Unterschrift“ und „Ort/Datum“, wo Ihr Kunde unterschreiben soll. Dann „Weiter“ und das Handy übergeben.'
        : 'Tippen Sie unten auf „Unterschrift“ und ziehen Sie das gelbe Feld auf die Unterschriftslinie. Mit dem Punkt unten rechts ändern Sie die Größe.');
      afterOpenSend().catch(e => console.warn('Vorlagen/Unterschrift:', e));
    } else {
      applyRequest();
    }
    renderBar();
    if (!S.inViewer) history.pushState({ unterschrift: 1 }, '');
    S.inViewer = true;
    window.scrollTo(0, 0);
    updateCur();
    if (S.mode === 'sign' && S.spots.length) setTimeout(() => scrollToObj(S.spots[0]), 120);
  }

  async function buildPages() {
    const box = $('#pages');
    S.pages.forEach(p => { if (p.url) URL.revokeObjectURL(p.url); });
    S.pages = [];
    box.innerHTML = '';
    if (io) io.disconnect();
    io = 'IntersectionObserver' in window ? new IntersectionObserver(onIntersect, { rootMargin: '900px 0px' }) : null;
    box.append(el('div', { id: 'bannerBox' }));
    const n = S.pdf.numPages;
    for (let i = 0; i < n; i++) {
      const page = await S.pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const wrap = el('div', { class: 'page', 'data-i': String(i) });
      const img = el('img', { alt: tr('Seite {n}', { n: i + 1 }), draggable: 'false' });
      const ov = el('div', { class: 'ov' });
      wrap.append(img, el('div', { class: 'load' }, el('i')), ov);
      box.append(wrap, el('div', { class: 'pnum', text: tr('Seite {a} von {b}', { a: i + 1, b: n }) }));
      S.pages.push({ i: i, W: vp.width, H: vp.height, T: Array.prototype.slice.call(vp.transform), wrap: wrap, img: img, ov: ov, k: 1, state: 0, rw: 0, url: '' });
    }
    decoratePages();
    relayout();
    S.pages.forEach(p => { if (io) io.observe(p.wrap); else queueRender(p); });
  }

  // Überschriften der Teile (mehrere PDFs) und Karte am Ende: Absender „Weiteres PDF anhängen“, Kunde „Stimmt etwas nicht?“
  function decoratePages() {
    const box = $('#pages');
    if (!box) return;
    box.querySelectorAll('.parthead, .endcard').forEach(n => n.remove());
    let list = null;
    const send = S.mode === 'send' && !S.view;
    if (send && S.parts.length > 1) list = S.parts.map(p => [partTitle(p), p.pages]);
    else if (S.mode === 'sign' && S.req && S.req.q && S.req.q.length > 1) list = S.req.q;
    if (list && list.reduce((a, x) => a + x[1], 0) === S.pages.length) {
      let off = 0;
      list.forEach((x, i) => {
        const pg = S.pages[off];
        off += x[1];
        if (!pg) return;
        box.insertBefore(el('div', { class: 'parthead' },
          el('span', { class: 'pn', text: String(i + 1) }),
          el('div', { class: 'grow' }, el('b', { text: x[0] }),
            el('span', { text: (send ? 'PDF ' + (i + 1) + ' von ' + list.length : tr('Dokument {a} von {b}', { a: i + 1, b: list.length })) + ' · ' + (x[1] === 1 ? tr('1 Seite') : tr('{n} Seiten', { n: x[1] })) })),
          send && i > 0 && !S.sent ? el('button', { type: 'button', class: 'linkbtn danger', text: 'Entfernen', onclick: () => removeParts(i, 1) }) : null), pg.wrap);
      });
    }
    if (send && !S.sent) {
      box.append(el('button', { type: 'button', class: 'endcard add', onclick: pickMore },
        el('span', { class: 'ic', html: I.plus }),
        el('span', { class: 'grow' }, el('b', { text: 'Weiteres PDF anhängen' }),
          el('small', { text: 'Zum Beispiel Beratungsdoku oder SEPA-Mandat. Ihr Kunde unterschreibt alles in einem Rutsch.' }))));
    } else if (S.mode === 'sign' && backMode() && !S.local) {
      box.append(el('div', { class: 'endcard ask' },
        el('b', { text: tr('Stimmt etwas nicht?') }),
        el('span', { text: tr('Dann nicht unterschreiben, sondern kurz Bescheid geben.') }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: I.mail + '<span>' + tr('Bescheid geben') + '</span>', onclick: openIssueSheet })));
    }
  }

  // Kunde: „Stimmt etwas nicht?“ – Nachricht an den Absender statt zu unterschreiben (Ende-zu-Ende verschlüsselt)
  function openIssueSheet() {
    if (!backMode()) return;
    const who = (S.req && S.req.f) || tr('den Absender');
    const ta = el('textarea', { class: 'in', rows: '4', maxlength: '1000', placeholder: tr('z. B. Mein Geburtsdatum stimmt nicht.') });
    const err = el('p', { class: 'err', role: 'alert' });
    const ok = el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.mail + '<span>' + tr('Nachricht senden') + '</span>' });
    const body = el('div', null,
      el('p', { class: 'prose', text: tr('Schreiben Sie kurz, was geändert werden soll. Die Nachricht geht an {who}. Unterschreiben müssen Sie dann noch nicht.', { who: who }) }),
      el('label', { class: 'fld' }, el('span', { text: tr('Was soll geändert werden?') }), ta),
      err, ok);
    ta.addEventListener('input', () => { err.textContent = ''; });
    ok.addEventListener('click', async () => {
      const text = ta.value.trim();
      if (text.length < 3) { err.textContent = tr('Bitte schreiben Sie kurz, was nicht stimmt.'); ta.focus(); return; }
      ok.disabled = true;
      busy(tr('Wird verschlüsselt gesendet …'));
      try {
        const msg = await sealHead({ m: text.slice(0, 1000), at: Date.now() }, S.req.k);
        await apiRetry('POST', '/api/doc/' + encodeURIComponent(S.req.d) + '/issue', { del: S.req.t, json: { msg: msg } }, 2);
        unbusy();
        body.innerHTML = '';
        body.append(el('div', { class: 'banner ok' }, el('span', { html: I.check }), el('p', { text: tr('Danke! Ihre Nachricht ist verschlüsselt an {who} gegangen.', { who: who }) })),
          el('button', { type: 'button', class: 'btn btn-ghost btn-block', text: tr('Zurück zum Dokument'), onclick: () => closeSheet() }));
      } catch (e) {
        unbusy();
        ok.disabled = false;
        err.textContent = e && e.code === 'too_many' ? tr('Sie haben schon mehrere Nachrichten geschickt. Bitte schreiben Sie direkt per WhatsApp.')
          : e && (e.code === 'signed' || e.code === 'http_409') ? (S.req.f ? tr('Dieses Dokument wurde bereits unterschrieben und an {who} übermittelt. Sie müssen nichts mehr tun.', { who: S.req.f })
            : tr('Dieses Dokument wurde bereits unterschrieben und an den Absender übermittelt. Sie müssen nichts mehr tun.'))
            : e && (e.code === 'not_found' || e.code === 'expired') ? tr('Dieser Link ist abgelaufen oder das Dokument wurde schon unterschrieben zurückgeschickt. Bitten Sie {who} um einen neuen Link.', { who: who })
              : tr('Senden hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung.');
      }
    });
    openSheet(tr('Stimmt etwas nicht?'), body);
    setTimeout(() => { try { ta.focus(); } catch (e) { /* egal */ } }, 330);
  }

  function onIntersect(entries) {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const pg = S.pages[+en.target.getAttribute('data-i')];
      if (pg && pg.state === 0) queueRender(pg);
    });
  }

  function queueRender(pg) {
    pg.state = 1;
    const doc = S.pdf;
    renderQueue = renderQueue.then(() => doc === S.pdf ? renderPage(pg, doc) : null).catch(err => { if (!err || err.name !== 'RenderingCancelledException') console.warn(err); pg.state = 0; });
  }

  async function renderPage(pg, doc) {
    const page = await doc.getPage(pg.i + 1);
    const cssW = pg.wrap.clientWidth || 360;
    let scale = cssW * dpr() / pg.W;
    const maxPx = 5e6;
    if (pg.W * pg.H * scale * scale > maxPx) scale = Math.sqrt(maxPx / (pg.W * pg.H));
    const vp = page.getViewport({ scale: scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    try { page.cleanup(); } catch (e) { /* egal */ }
    if (doc !== S.pdf) return;
    const blob = await new Promise(r => { try { c.toBlob(r, 'image/jpeg', 0.92); } catch (e) { r(null); } });
    let node;
    if (blob) {
      const url = URL.createObjectURL(blob);
      node = el('img', { alt: tr('Seite {n}', { n: pg.i + 1 }), draggable: 'false' });
      await new Promise(r => { node.onload = node.onerror = r; node.src = url; });
      if (pg.url) URL.revokeObjectURL(pg.url);
      pg.url = url;
      c.width = c.height = 0;
    } else {
      c.className = 'pg';
      node = c;
    }
    pg.img.replaceWith(node);
    pg.img = node;
    pg.rw = vp.width;
    pg.state = 2;
    pg.wrap.classList.add('ready');
  }

  function relayout() {
    if (!S.pages.length || $('#viewer').classList.contains('hidden')) return;
    const vh = window.innerHeight;
    S.pages.forEach(pg => {
      const cssW = pg.wrap.clientWidth;
      if (!cssW) return;
      pg.k = cssW / pg.W;
      pg.wrap.style.height = (cssW * pg.H / pg.W) + 'px';
      if (pg.state === 2 && cssW * dpr() > pg.rw * 1.35) {
        const r = pg.wrap.getBoundingClientRect();
        if (r.bottom > -vh && r.top < vh * 2) queueRender(pg); else pg.state = 0;
      }
    });
    S.items.forEach(o => { if (o.type === 'sig') paintObj(o); layoutObj(o); });
    S.own.forEach(o => { paintObj(o); layoutObj(o); });
    S.spots.forEach(layoutObj);
  }

  let scrollRaf = 0;
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateCur(); });
  }
  function updateCur() {
    if (!S.pages.length) return;
    const top = 60, bottom = window.innerHeight - 84, vis = Math.max(1, bottom - top);
    let best = 0, bestScore = -1;
    S.pages.forEach((pg, i) => {
      const r = pg.wrap.getBoundingClientRect();
      const v = Math.min(r.bottom, bottom) - Math.max(r.top, top);
      if (v <= 0) return;
      const score = Math.max(v / Math.max(1, r.height), v / vis);
      if (score > bestScore + 0.01) { bestScore = score; best = i; }
    });
    S.cur = best;
    $('#pageInfo').textContent = tr('Seite {a} von {b}', { a: best + 1, b: S.pages.length });
  }

  // Hinweis über dem Dokument; action = { label, fn } für einen Knopf im Hinweis
  function banner(type, text, action) {
    const box = $('#bannerBox');
    if (!box) return;
    box.innerHTML = '';
    if (!text) return;
    const b = el('div', { class: 'banner' + (type === 'warn' ? ' warn' : type === 'ok' ? ' ok' : ''), role: type === 'warn' ? 'alert' : 'note' },
      el('span', { html: type === 'warn' ? I.warn : type === 'ok' ? I.check : I.info }),
      el('p', { text: text }),
      action ? el('button', { type: 'button', class: 'act', text: action.label, onclick: () => { box.innerHTML = ''; action.fn(); } }) : null,
      el('button', { type: 'button', class: 'x', 'aria-label': tr('Hinweis schließen'), text: '×', onclick: () => { box.innerHTML = ''; } }));
    box.append(b);
  }

  /* ---------------- Anfrage aus dem Link ---------------- */
  function applyRequest() {
    const r = S.req;
    if (!r) return;
    S.hashMatch = r.h && S.file.hash ? S.file.hash.indexOf(r.h) === 0 : null;
    const pagesOk = !r.p || r.p === S.pages.length;
    if (pagesOk) {
      r.s.forEach(a => {
        const pi = a[1] - 1;
        const pg = S.pages[pi];
        if (!pg) return;
        const w = clamp(a[4], 12, pg.W), h = clamp(a[5], 8, pg.H);
        S.spots.push({ id: nid(), type: 'spot', k: a[0], page: pi, x: clamp(a[2], 0, pg.W - w), y: clamp(a[3], 0, pg.H - h), w: w, h: h, fill: null, who: a[0] === 's' && a[6] === 1 ? 1 : 0 });
      });
      S.spots.forEach(renderSpot);
    }
    const nSig = S.spots.filter(s => s.k === 's').length;
    if (!pagesOk) {
      banner('warn', tr('Dieses PDF passt nicht zur Anfrage (andere Seitenzahl). Bitte prüfen Sie, ob Sie das richtige Dokument gewählt haben. Sie können trotzdem unterschreiben und die Unterschrift selbst platzieren.'));
    } else if (S.hashMatch === false) {
      banner('warn', tr('Dieses PDF ist nicht genau das angeforderte Dokument. Wählen Sie am besten das PDF aus der Nachricht. Sie können trotzdem unterschreiben.'));
    } else if (nSig && twoReq()) {
      banner('info', tr('Zwei Personen unterschreiben nacheinander: zuerst {a}, dann {b}.', { a: personSubj(0), b: personSubj(1) }) + ' ' + tr('Die markierten Stellen werden automatisch ausgefüllt.'));
    } else if (nSig) {
      banner('info', nSig === 1
        ? tr('Die gelb markierte Stelle wird nach dem Unterschreiben automatisch ausgefüllt.')
        : tr('Die {n} gelb markierten Stellen werden nach dem Unterschreiben automatisch ausgefüllt.', { n: nSig }));
    }
  }

  /* ---------------- Objekte auf der Seite ---------------- */
  // who: 0 = Kunde (erste Person), 1 = zweite Person
  function caption(d, who) {
    const n = nameOf(who || 0);
    return (n ? n + ' · ' : '') + 'elektronisch unterschrieben · ' + fmtDate(d) + ', ' + fmtTime(d) + ' Uhr';
  }
  function capSize(w, who) { return clamp(w / (caption(new Date(), who).length * 0.5), 3.6, 6.2); }
  function capH(w, who) { return capSize(w, who) * 1.6; }
  function sigH(w, who) { const s = sigOf(who || 0); return capH(w, who) + w * s.bh / s.bw; }
  // Eigene Unterschrift des Absenders (Vermittler): Bildunterschrift mit seinem Namen aus dem Briefkopf
  function ownCaption(d) {
    const n = loadSender().name;
    return (n ? n + ' · ' : '') + 'elektronisch unterschrieben · ' + fmtDate(d) + ', ' + fmtTime(d) + ' Uhr';
  }
  function ownCapSize(w) { return clamp(w / (ownCaption(new Date()).length * 0.5), 3.6, 6.2); }
  function ownH(w) { return ownCapSize(w) * 1.6 + w * S.mySig.bh / S.mySig.bw; }
  let measureCtx = null;
  function textWidth(o) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = '100px Helvetica, Arial, sans-serif';
    return measureCtx.measureText(o.text).width / 100 * o.size;
  }
  function objW(o) { return o.type === 'text' ? textWidth(o) : o.w; }
  function objH(o) { return o.type === 'sig' ? sigH(o.w, o.who) : o.type === 'own' ? ownH(o.w) : o.type === 'text' ? o.size * 1.25 : o.h; }

  function sigSvgOf(s, w, text, cs, h) {
    const sc = w / s.bw;
    return '<svg viewBox="0 0 ' + r2(w) + ' ' + r2(h) + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<text x="0" y="' + r2(cs * 1.1) + '" font-size="' + r2(cs) + '" fill="' + CAP_CSS + '" font-family="Helvetica, Arial, sans-serif">' + esc(text) + '</text>' +
      '<g transform="translate(0 ' + r2(cs * 1.6) + ') scale(' + (Math.round(sc * 10000) / 10000) + ')">' +
      '<path d="' + s.path + '" fill="none" stroke="' + INK_CSS + '" stroke-width="' + r2(s.sw) + '" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';
  }
  function sigSvg(w, who) { return sigSvgOf(sigOf(who || 0), w, caption(new Date(), who), capSize(w, who), sigH(w, who)); }
  function ownSvg(w) { return sigSvgOf(S.mySig, w, ownCaption(new Date()), ownCapSize(w), ownH(w)); }

  function renderItem(it, fresh) {
    if (!it.node) {
      const n = el('div', { class: 'item ' + it.type + (fresh ? ' fresh' : '') });
      const vis = el('div', { class: 'vis' });
      const del = el('button', { type: 'button', class: 'h-del', 'data-role': 'del', 'aria-label': tr('Entfernen'), html: I.x });
      del.addEventListener('click', e => { e.stopPropagation(); removeObj(it); });
      n.append(vis, del, el('span', { class: 'h-rs', 'data-role': 'resize', 'aria-hidden': 'true', html: I.resize }));
      bindDrag(n, it);
      it.node = n;
      it.vis = vis;
    }
    const pg = S.pages[it.page];
    if (it.node.parentNode !== pg.ov) pg.ov.append(it.node);
    paintObj(it);
    layoutObj(it);
  }

  function paintObj(o) {
    if (!o.vis) return;
    if (o.type === 'sig') o.vis.innerHTML = sigSvg(o.w, o.who);
    else if (o.type === 'own') o.vis.innerHTML = ownSvg(o.w);
    else if (o.type === 'text') { o.vis.innerHTML = ''; o.vis.append(el('span', { class: 'tx', text: o.text })); }
  }

  function layoutObj(o) {
    const pg = S.pages[o.page];
    if (!pg || !o.node) return;
    const k = pg.k, n = o.node;
    n.style.left = (o.x * k) + 'px';
    n.style.top = (o.y * k) + 'px';
    // Hinweis am Kundenfeld: rechtsbündig, wenn er sonst aus der Seite ragen würde
    if (o.type === 'spot' && o.node.firstChild && o.node.firstChild.className === 'tag') o.node.classList.toggle('tag-r', o.x * k + o.node.firstChild.offsetWidth > pg.wrap.clientWidth - 4);
    if (o.type === 'text') {
      n.style.width = '';
      n.style.height = '';
      if (o.vis.firstChild) o.vis.firstChild.style.fontSize = (o.size * k) + 'px';
    } else {
      n.style.width = (o.w * k) + 'px';
      n.style.height = (objH(o) * k) + 'px';
    }
    n.classList.toggle('sel', S.sel === o);
  }

  function renderSpot(sp) {
    if (!sp.node) {
      const n = el('div', { class: 'spot ' + (S.mode === 'send' ? 'edit' : 'cust') });
      if (S.mode === 'send') {
        const del = el('button', { type: 'button', class: 'h-del', 'data-role': 'del', 'aria-label': 'Feld entfernen', html: I.x });
        del.addEventListener('click', e => { e.stopPropagation(); removeObj(sp); });
        sp.lbl = el('span', { class: 'lbl' });
        n.append(sp.lbl, del, el('span', { class: 'h-rs', 'data-role': 'resize', 'aria-hidden': 'true', html: I.resize }));
        if (sp.k === 's') {
          // Wer unterschreibt hier? Kunde oder eine zweite Person (z. B. Ehepartner) – sichtbar, solange das Feld gewählt ist
          sp.whoBox = el('span', { class: 'who', role: 'group', 'aria-label': 'Wer unterschreibt hier?' },
            el('button', { type: 'button', 'data-role': 'who', 'data-w': '0', text: 'Kunde' }),
            el('button', { type: 'button', 'data-role': 'who', 'data-w': '1', text: '2. Person' }));
          sp.whoBox.addEventListener('click', e => {
            const b = e.target.closest('button[data-w]');
            if (!b) return;
            e.stopPropagation();
            setWho(sp, +b.getAttribute('data-w'));
          });
          n.append(sp.whoBox);
        }
        bindDrag(n, sp);
      } else {
        n.setAttribute('role', 'button');
        const pn = sp.k === 's' && twoReq() ? personName(sp.who || 0) : '';
        const tag = sp.k === 's' && twoReq() ? (pn ? shortName(pn) : personTag(sp.who || 0)) + ' · ' + tr('Hier unterschreiben') : tr('Hier unterschreiben');
        n.setAttribute('aria-label', sp.k === 's' ? tag : tr('Ort und Datum einsetzen'));
        n.append(el('span', { class: 'tag', html: (sp.k === 's' ? I.penS + esc(tag) : I.calS + esc(tr('Ort, Datum'))) }));
        n.addEventListener('click', () => onSpotTap(sp));
      }
      sp.node = n;
    }
    const pg = S.pages[sp.page];
    if (sp.node.parentNode !== pg.ov) pg.ov.prepend(sp.node);
    sp.node.classList.toggle('filled', !!sp.fill);
    sp.node.classList.toggle('p2', sp.k === 's' && sp.who === 1);
    if (sp.lbl) sp.lbl.textContent = sp.k === 's' ? (sp.who === 1 ? 'Unterschrift 2. Person' : 'Unterschrift') : 'Ort, Datum';
    if (sp.whoBox) sp.whoBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.getAttribute('data-w') === (sp.who || 0) ? 'true' : 'false'));
    layoutObj(sp);
  }
  // Absender: Feld der zweiten Person zuordnen (oder zurück zum Kunden)
  function setWho(sp, w) {
    if ((sp.who || 0) === w) return;
    sp.who = w ? 1 : 0;
    renderSpot(sp);
    S.dirty = true;
    toast(w ? 'Hier unterschreibt die 2. Person, zum Beispiel der Ehepartner. Ihr Kunde gibt dafür das Handy weiter.' : 'Hier unterschreibt Ihr Kunde.', 4200);
  }
  // Kunde: Unterschreiben zwei Personen? Dann trägt jedes Feld den Namen (oder „1. Person“ / „2. Person“)
  const twoReq = () => S.spots.some(sp => sp.k === 's' && sp.who === 1);
  const sigOf = who => who === 1 ? S.sig2 : S.sig;
  const nameOf = who => who === 1 ? S.name2 : S.name;
  function personName(who) {
    const n = cleanLabel(who === 1 ? (S.name2 || (S.req && S.req.c2)) : (S.name || (S.req && S.req.c)));
    return n.length > 24 ? n.slice(0, 23) + '…' : n;
  }
  const personTag = who => personName(who) || (who === 1 ? tr('2. Person') : tr('1. Person'));
  // Vorname für die kurzen Hinweise an den Feldern („Arben · Hier unterschreiben“)
  function shortName(n) {
    const w = String(n).split(' ');
    return w.length > 1 && !/^(herr|frau|familie|fam\.?|dr\.?|prof\.?|\d+\.)$/i.test(w[0]) ? w[0] : n;
  }
  const personSubj = who => personName(who) || (who === 1 ? tr('die 2. Person') : tr('die 1. Person'));

  function select(o) {
    const prev = S.sel;
    S.sel = o || null;
    if (prev && prev !== o && prev.node) prev.node.classList.remove('sel');
    if (o && o.node) o.node.classList.add('sel');
  }

  function pageAt(y) {
    for (let i = 0; i < S.pages.length; i++) {
      const r = S.pages[i].wrap.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return S.pages[i];
    }
    return null;
  }

  function bindDrag(node, o) {
    node.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      const roleEl = e.target.closest('[data-role]');
      const role = roleEl ? roleEl.getAttribute('data-role') : 'move';
      if (role === 'del' || role === 'who') return;
      e.preventDefault();
      e.stopPropagation();
      const wasSel = S.sel === o;
      select(o);
      const r0 = node.getBoundingClientRect();
      const off = { x: e.clientX - r0.left, y: e.clientY - r0.top };
      const st = { x: e.clientX, y: e.clientY, ow: objW(o), size: o.size, w: o.w, h: o.h };
      const pid = e.pointerId;
      let last = e, moved = false, raf = 0, active = true;
      try { node.setPointerCapture(pid); } catch (x) { /* egal */ }
      const apply = () => {
        let pg = S.pages[o.page];
        if (role === 'resize') {
          resizeObj(o, st, (last.clientX - st.x) / pg.k, (last.clientY - st.y) / pg.k, pg);
          layoutObj(o);
          return;
        }
        const hit = pageAt(last.clientY);
        if (hit && hit !== pg) {
          o.page = hit.i;
          pg = hit;
          hit.ov.append(node);
          if (o.spot) {
            const sp = S.spots.find(x => x.id === o.spot);
            o.spot = null;
            if (sp) { sp.fill = null; renderSpot(sp); }
          }
        }
        const r = pg.wrap.getBoundingClientRect();
        o.x = clamp((last.clientX - off.x - r.left) / pg.k, 0, Math.max(0, pg.W - objW(o)));
        o.y = clamp((last.clientY - off.y - r.top) / pg.k, 0, Math.max(0, pg.H - objH(o)));
        layoutObj(o);
      };
      const loop = () => {
        raf = 0;
        if (!active || !moved || role !== 'move') return;
        const y = last.clientY, vh = window.innerHeight;
        let dy = 0;
        if (y > vh - 120) dy = Math.min(16, (y - vh + 120) / 5 + 2);
        else if (y < 120) dy = -Math.min(16, (120 - y) / 5 + 2);
        if (dy) { window.scrollBy(0, dy); apply(); }
        raf = requestAnimationFrame(loop);
      };
      const move = ev => {
        if (ev.pointerId !== pid) return;
        last = ev;
        if (!moved && Math.abs(ev.clientX - st.x) + Math.abs(ev.clientY - st.y) < 5) return;
        if (!moved) { moved = true; if (!raf) raf = requestAnimationFrame(loop); }
        apply();
      };
      const up = ev => {
        if (ev.pointerId !== pid) return;
        active = false;
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (moved) { S.dirty = true; renderBar(); }
        else if (role === 'move' && wasSel && o.type === 'text') openTextSheet(o);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  function resizeObj(o, st, dx, dy, pg) {
    if (o.type === 'sig' || o.type === 'own') {
      const hOf = o.type === 'own' ? ownH : (w => sigH(w, o.who));
      let w = clamp(st.w + dx, 50, pg.W - o.x);
      let guard = 0;
      while (w > 50 && o.y + hOf(w) > pg.H && guard++ < 200) w -= 2;
      o.w = w;
      paintObj(o);
    } else if (o.type === 'text') {
      o.size = clamp(st.size * (st.ow + dx) / st.ow, 5, 36);
      paintObj(o);
    } else {
      o.w = clamp(st.w + dx, 24, pg.W - o.x);
      o.h = clamp(st.h + dy, 10, pg.H - o.y);
    }
  }

  function removeObj(o) {
    if (o.node) o.node.remove();
    o.node = null;
    if (o.type === 'spot') {
      S.spots = S.spots.filter(x => x !== o);
    } else if (o.type === 'own') {
      S.own = S.own.filter(x => x !== o);
    } else {
      S.items = S.items.filter(x => x !== o);
      if (o.spot) {
        const sp = S.spots.find(s => s.id === o.spot);
        if (sp) { sp.fill = null; renderSpot(sp); }
      }
    }
    if (S.sel === o) S.sel = null;
    S.dirty = S.items.length > 0 || S.mode === 'send';
    renderBar();
  }

  function visibleCenterPt(pg) {
    const r = pg.wrap.getBoundingClientRect();
    const top = Math.max(r.top, 70), bottom = Math.min(r.bottom, window.innerHeight - 100);
    const mid = bottom > top ? (top + bottom) / 2 : (r.top + r.bottom) / 2;
    return (mid - r.top) / pg.k;
  }

  function scrollToObj(o) {
    if (!o) return;
    const pg = S.pages[o.page];
    if (!pg) return;
    const r = pg.wrap.getBoundingClientRect();
    const y = window.pageYOffset + r.top + o.y * pg.k - window.innerHeight * 0.4;
    try { window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); } catch (e) { window.scrollTo(0, Math.max(0, y)); }
  }

  /* ---------------- Kunde: unterschreiben ---------------- */
  function ortDatum() { return (S.ort ? S.ort + ', ' : '') + fmtDate(new Date()); }

  function onSpotTap(sp) {
    const who = sp.k === 's' ? (sp.who || 0) : 0;
    if (sp.k === 's' ? !sigOf(who) : !(S.sig || S.sig2)) { openPad({ via: 'spot', who: who }); return; }
    const it = fillSpot(sp, true);
    if (it) toast(tr('Eingesetzt. Zum Verschieben ziehen.'));
    renderBar();
  }

  function fillSpot(sp, doSelect) {
    if (sp.fill) return null;
    const pg = S.pages[sp.page];
    let it;
    if (sp.k === 's') {
      const who = sp.who || 0;
      if (!sigOf(who)) return null; // diese Person hat noch nicht unterschrieben
      let w = Math.min(sp.w, pg.W - sp.x);
      let guard = 0;
      while (w > 40 && sigH(w, who) > sp.h && guard++ < 80) w *= 0.96;
      const h = sigH(w, who);
      it = { id: nid(), type: 'sig', page: sp.page, x: sp.x, y: clamp(sp.y + sp.h - h, 0, Math.max(0, pg.H - h)), w: w, spot: sp.id, who: who };
    } else {
      const size = clamp(sp.h * 0.62, 7, 12);
      it = { id: nid(), type: 'text', page: sp.page, x: sp.x + 2, y: clamp(sp.y + (sp.h - size * 1.25) / 2, 0, pg.H - size * 1.25), size: size, text: ortDatum(), spot: sp.id, auto: true };
    }
    sp.fill = it.id;
    S.items.push(it);
    renderItem(it, true);
    renderSpot(sp);
    if (doSelect) select(it);
    S.dirty = true;
    return it;
  }

  function placeSig(pi, who) {
    who = who || 0;
    const pg = S.pages[pi], sg = sigOf(who);
    const w = clamp(48 * sg.bw / sg.bh, 80, 160);
    const h = sigH(w, who);
    const cy = visibleCenterPt(pg);
    const it = { id: nid(), type: 'sig', page: pi, x: clamp(pg.W * 0.12, 0, Math.max(0, pg.W - w)), y: clamp(cy - h / 2, 0, Math.max(0, pg.H - h)), w: w, who: who };
    S.items.push(it);
    renderItem(it, true);
    select(it);
    S.dirty = true;
    return it;
  }

  function placeText(pi, text, auto) {
    const pg = S.pages[pi];
    const it = { id: nid(), type: 'text', page: pi, x: 0, y: 0, size: 10, text: text, auto: !!auto };
    it.x = clamp(pg.W * 0.12, 0, Math.max(0, pg.W - textWidth(it)));
    it.y = clamp(visibleCenterPt(pg) - 6, 0, pg.H - 12.5);
    S.items.push(it);
    renderItem(it, true);
    select(it);
    S.dirty = true;
    renderBar();
    toast(tr('Zum Verschieben ziehen. Nochmal antippen zum Ändern.'));
    return it;
  }

  function makePad(init) {
    const wrap = el('div', { class: 'padwrap' + (init && init.length ? ' inked' : '') });
    const cv = el('canvas', { 'aria-label': tr('Unterschriftsfeld') });
    wrap.append(el('div', { class: 'base' }), el('div', { class: 'xm', text: '×' }), el('div', { class: 'ph', text: tr('Hier mit dem Finger unterschreiben') }), cv);
    let strokes = init ? init.map(s => s.map(p => p.slice())) : [];
    let cur = null, ctx = null, W = 0, H = 0, ratio = 1, rect = null, raf = 0;
    const lw = () => Math.max(2.2, W / 135);
    function draw() {
      raf = 0;
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = INK_CSS;
      ctx.lineWidth = lw();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      strokes.forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s[0][0], s[0][1]);
        if (s.length === 1) ctx.lineTo(s[0][0] + 0.01, s[0][1]);
        else if (s.length === 2) ctx.lineTo(s[1][0], s[1][1]);
        else {
          for (let i = 1; i < s.length - 1; i++) ctx.quadraticCurveTo(s[i][0], s[i][1], (s[i][0] + s[i + 1][0]) / 2, (s[i][1] + s[i + 1][1]) / 2);
          const l = s[s.length - 1];
          ctx.lineTo(l[0], l[1]);
        }
        ctx.stroke();
      });
    }
    const req = () => { if (!raf) raf = requestAnimationFrame(draw); };
    function resize() {
      const r = wrap.getBoundingClientRect();
      if (!r.width) return;
      W = r.width; H = r.height;
      ratio = Math.min(window.devicePixelRatio || 1, 3);
      cv.width = Math.round(W * ratio);
      cv.height = Math.round(H * ratio);
      ctx = cv.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }
    const pt = e => [r1(clamp(e.clientX - rect.left, 0, W)), r1(clamp(e.clientY - rect.top, 0, H))];
    cv.addEventListener('pointerdown', e => {
      if (e.button > 0 || cur) return;
      e.preventDefault();
      if (!ctx) resize();
      rect = cv.getBoundingClientRect();
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* egal */ }
      cur = [pt(e)];
      cur.pid = e.pointerId;
      strokes.push(cur);
      wrap.classList.add('inked');
      req();
    });
    cv.addEventListener('pointermove', e => {
      if (!cur || e.pointerId !== cur.pid) return;
      e.preventDefault();
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      (list && list.length ? list : [e]).forEach(ev => {
        const p = pt(ev), l = cur[cur.length - 1];
        if (Math.abs(p[0] - l[0]) + Math.abs(p[1] - l[1]) >= 1.5) cur.push(p);
      });
      req();
    });
    const end = e => { if (cur && (!e || e.pointerId === cur.pid)) { cur = null; req(); } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    const onR = debounce(resize, 120);
    window.addEventListener('resize', onR);
    return {
      node: wrap,
      resize: resize,
      clear() { strokes = []; cur = null; wrap.classList.remove('inked'); draw(); },
      strokes: () => strokes.map(s => s.map(p => p.slice())),
      width: () => W,
      valid() {
        let len = 0;
        strokes.forEach(s => { for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); });
        return len > 45;
      },
      destroy() { window.removeEventListener('resize', onR); }
    };
  }

  function strokesToPath(strokes, ox, oy) {
    const f = n => String(Math.round(n * 10) / 10);
    let d = '';
    strokes.forEach(s0 => {
      const s = s0.map(p => [p[0] - ox, p[1] - oy]);
      d += 'M' + f(s[0][0]) + ' ' + f(s[0][1]);
      if (s.length === 1) { d += 'L' + f(s[0][0] + 0.1) + ' ' + f(s[0][1]); return; }
      if (s.length === 2) { d += 'L' + f(s[1][0]) + ' ' + f(s[1][1]); return; }
      for (let i = 1; i < s.length - 1; i++) {
        d += 'Q' + f(s[i][0]) + ' ' + f(s[i][1]) + ' ' + f((s[i][0] + s[i + 1][0]) / 2) + ' ' + f((s[i][1] + s[i + 1][1]) / 2);
      }
      const l = s[s.length - 1];
      d += 'L' + f(l[0]) + ' ' + f(l[1]);
    });
    return d;
  }

  function adoptSignature(strokes, padW, who) { const sg = sigFromStrokes(strokes, padW); if (who === 1) S.sig2 = sg; else S.sig = sg; }
  function sigFromStrokes(strokes, padW) {
    const sw = Math.max(2.2, padW / 135);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    strokes.forEach(s => s.forEach(p => {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }));
    const m = sw / 2 + 1;
    let bw = x1 - x0 + 2 * m, bh = y1 - y0 + 2 * m;
    let ox = x0 - m, oy = y0 - m;
    if (bh < bw * 0.14) { oy -= (bw * 0.14 - bh) / 2; bh = bw * 0.14; }
    if (bw < bh * 0.4) { ox -= (bh * 0.4 - bw) / 2; bw = bh * 0.4; }
    return { path: strokesToPath(strokes, ox, oy), bw: bw, bh: bh, sw: sw };
  }

  // opts.who: 0 = Kunde (erste Person), 1 = zweite Person (z. B. Ehepartner)
  function openPad(opts) {
    opts = opts || {};
    const who = opts.who === 1 ? 1 : 0, two = twoReq();
    const pre = who === 1 ? (S.name2 || (S.req && S.req.c2) || '') : (S.name || (S.req && S.req.c) || '');
    const name = el('input', { class: 'in', type: 'text', autocomplete: S.local || who === 1 ? 'off' : 'name', autocapitalize: 'words', enterkeyhint: 'next', placeholder: tr('Vor- und Nachname'), value: pre, maxlength: '80' });
    const ort = el('input', { class: 'in', type: 'text', autocomplete: 'address-level2', autocapitalize: 'words', enterkeyhint: 'done', placeholder: tr('z. B. Remscheid'), value: S.ort, maxlength: '60' });
    const pad = makePad(who === 1 ? padMem2 : padMem);
    const err = el('p', { class: 'err', role: 'alert' });
    const ok = el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.check + '<span>' + tr('Übernehmen') + '</span>' });
    const hasDate = S.spots.some(s => s.k === 'd');
    const askOrt = who === 0 || (hasDate && !S.ort); // die zweite Person nur, wenn noch kein Ort da ist
    const body = el('div', null,
      el('label', { class: 'fld' }, el('span', { text: tr('Ihr Name') }), name),
      askOrt ? el('label', { class: 'fld' }, el('span', { text: hasDate ? tr('Ort (für „Ort, Datum“)') : tr('Ort (optional)') }), ort) : null,
      el('div', { class: 'lblrow' }, el('span', { text: tr('Ihre Unterschrift') }),
        el('button', { type: 'button', text: tr('Löschen'), onclick: () => { pad.clear(); err.textContent = ''; } })),
      pad.node,
      el('p', { class: 'legal', text: tr('Mit „Übernehmen“ bestätigen Sie, dass dies Ihre Unterschrift ist. Damit unterschreiben Sie das Dokument elektronisch.') }),
      err, ok);
    name.addEventListener('input', () => name.classList.remove('bad'));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (askOrt) ort.focus(); else name.blur(); } });
    ort.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ort.blur(); } });
    const keep = () => { if (who === 1) padMem2 = pad.strokes(); else padMem = pad.strokes(); };
    ok.addEventListener('click', () => {
      const nm = name.value.replace(/\s+/g, ' ').trim();
      if (nm.length < 2) { err.textContent = tr('Bitte geben Sie Ihren Namen ein.'); name.classList.add('bad'); return; }
      if (!pad.valid()) { err.textContent = tr('Bitte unterschreiben Sie im weißen Feld.'); return; }
      const had = sigOf(who);
      const before = had ? S.items.filter(i => i.type === 'sig' && (i.who || 0) === who).map(i => [i, i.y + sigH(i.w, who)]) : [];
      if (who === 1) S.name2 = nm; else S.name = nm;
      if (askOrt) S.ort = ort.value.replace(/\s+/g, ' ').trim();
      keep();
      adoptSignature(pad.strokes(), pad.width(), who);
      before.forEach(b => {
        const it = b[0], pg = S.pages[it.page], h = sigH(it.w, who);
        it.y = clamp(b[1] - h, 0, Math.max(0, pg.H - h));
        paintObj(it); layoutObj(it);
      });
      closeSheet();
      afterAdopt(!had, opts, who);
    });
    openSheet(two ? tr('Unterschrift: {name}', { name: personTag(who) }) : sigOf(who) ? tr('Unterschrift ändern') : tr('Unterschreiben'), body, { onClose: () => { keep(); pad.destroy(); } });
    requestAnimationFrame(() => requestAnimationFrame(pad.resize));
  }

  function afterAdopt(first, opts, who) {
    who = who || 0;
    S.items.forEach(it => {
      if (it.type === 'text' && it.auto) { it.text = ortDatum(); paintObj(it); layoutObj(it); }
      if (it.type === 'sig') { paintObj(it); layoutObj(it); }
    });
    // Ort/Datum füllt, wer zuerst unterschreibt; Unterschriftsfelder nur die eigenen
    const open = S.spots.filter(s => !s.fill && (s.k === 'd' || (s.who || 0) === who));
    const next = twoReq() && !sigOf(who === 1 ? 0 : 1) ? (who === 1 ? 0 : 1) : -1; // wer noch unterschreiben muss
    if (open.length) {
      const filled = open.map(sp => fillSpot(sp, false)).filter(Boolean);
      select(null);
      renderBar();
      const sigs = filled.filter(i => i.type === 'sig');
      if (next >= 0) banner('info', tr('Danke! Jetzt unterschreibt {name}. Bitte das Handy weitergeben.', { name: personSubj(next) }));
      else if (S.hashMatch !== false) banner('info', tr('Die markierten Stellen sind ausgefüllt. Prüfen Sie kurz alles und tippen Sie dann auf „Fertig“.'));
      scrollToObj(sigs[0] || filled[0]);
      if (sigs.length) toast(sigs.length > 1 ? tr('Unterschrift an {n} Stellen eingesetzt. Bitte kurz prüfen.', { n: sigs.length }) : tr('Unterschrift eingesetzt. Bitte kurz prüfen.'), 3600);
      return;
    }
    if (first || opts.via === 'add' || !S.items.some(i => i.type === 'sig' && (i.who || 0) === who)) {
      const it = placeSig(S.cur, who);
      renderBar();
      scrollToObj(it);
      toast(tr('Schieben Sie die Unterschrift an die richtige Stelle. Größe ändern: blauen Punkt ziehen.'), 4500);
      return;
    }
    renderBar();
    toast(tr('Unterschrift geändert.'));
  }

  function insertSigAgain() {
    const open = S.spots.filter(sp => !sp.fill && sp.k === 's' && sigOf(sp.who || 0));
    if (open.length) {
      const filled = open.map(sp => fillSpot(sp, false)).filter(Boolean);
      renderBar();
      scrollToObj(filled[0]);
      return;
    }
    const it = placeSig(S.cur, S.sig ? 0 : 1);
    renderBar();
    scrollToObj(it);
  }

  function openTextSheet(it, preset) {
    const input = el('input', { class: 'in', type: 'text', value: it ? it.text : (preset || ''), placeholder: tr('Text eingeben'), enterkeyhint: 'done', maxlength: '120' });
    const ok = el('button', { type: 'button', class: 'btn btn-primary btn-block', html: I.check + '<span>' + (it ? tr('Speichern') : tr('Einfügen')) + '</span>' });
    const submit = () => {
      const v = input.value.replace(/\s+/g, ' ').trim();
      if (!v) { input.classList.add('bad'); input.focus(); return; }
      closeSheet();
      if (it) { it.text = v; it.auto = false; paintObj(it); layoutObj(it); S.dirty = true; }
      else placeText(S.cur, v, false);
    };
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const kids = [el('label', { class: 'fld' }, el('span', { text: tr('Text') }), input), ok];
    if (it) kids.push(el('button', { type: 'button', class: 'btn btn-ghost btn-block', text: tr('Entfernen'), onclick: () => { closeSheet(); removeObj(it); } }));
    openSheet(it ? tr('Text ändern') : tr('Text einfügen'), el('div', null, kids[0], kids[1], kids[2] || null));
    setTimeout(() => { try { input.focus(); } catch (e) { /* egal */ } }, 330);
  }

  function openAddSheet() {
    const opt = (icon, title, sub, fn) => el('button', { type: 'button', onclick: () => { closeSheet(); setTimeout(fn, 80); } },
      el('span', { class: 'ic', html: icon }), el('span', null, el('b', { text: title }), el('small', { text: sub })));
    const two = twoReq(), who = [0, 1].filter(w => sigOf(w) && (w === 0 || two));
    const tag = w => two ? ' · ' + personTag(w) : '';
    const body = el('div', { class: 'menu' },
      ...who.map(w => opt(I.pen, tr('Unterschrift einfügen') + tag(w), tr('Auf Seite {n}, dann an die Stelle schieben', { n: S.cur + 1 }), () => { const it = placeSig(S.cur, w); scrollToObj(it); renderBar(); })),
      opt(I.cal, tr('Ort und Datum einfügen'), ortDatum(), () => placeText(S.cur, ortDatum(), true)),
      opt(I.text, tr('Text einfügen'), tr('Zum Beispiel Ihr Name in Druckschrift'), () => openTextSheet(null, '')),
      ...who.map(w => opt(I.redo, tr('Unterschrift neu zeichnen') + tag(w), tr('Ersetzt die Unterschrift überall'), () => openPad({ via: 'resign', who: w }))),
      backMode() && !S.local ? opt(I.warn, tr('Stimmt etwas nicht?'), tr('Kurz Bescheid geben statt unterschreiben'), openIssueSheet) : null);
    openSheet(tr('Hinzufügen'), body);
  }

  function renderBar() {
    const bar = $('#bar');
    bar.innerHTML = '';
    const row = el('div', { class: 'row' });
    if (S.view) {
      row.append(
        el('button', { type: 'button', class: 'btn btn-ghost btn-xl', onclick: () => download(S.file.bytes, S.file.name), html: I.download + '<span>Speichern</span>' }),
        el('button', { type: 'button', class: 'btn btn-primary btn-xl', onclick: () => shareFile(S.file.bytes, S.file.name), html: I.share + '<span>Teilen</span>' }));
    } else if (S.mode === 'send') {
      row.append(
        el('button', { type: 'button', class: 'btn btn-soft cmp', onclick: () => addSpot('s'), html: I.pen + '<span>Unterschrift</span>' }),
        el('button', { type: 'button', class: 'btn btn-soft cmp', onclick: () => addSpot('d'), html: I.cal + '<span>Ort/Datum</span>' }),
        el('button', { type: 'button', class: 'btn btn-primary cmp', onclick: openSendSheet, html: '<span>Weiter</span>' + I.arrow }));
    } else if (!S.sig && !S.sig2) {
      const n = S.spots.filter(s => s.k === 's').length;
      row.append(el('button', { type: 'button', class: 'btn btn-primary btn-xl', onclick: () => openPad({ via: 'bar', who: 0 }), html: I.pen + '<span>' + (n ? tr('Jetzt unterschreiben') : tr('Unterschreiben')) + '</span>' }));
    } else if (twoReq() && (!S.sig || !S.sig2)) {
      // Zwei Personen: die andere ist noch dran
      const nxt = S.sig ? 1 : 0;
      row.append(
        el('button', { type: 'button', class: 'btn btn-ghost btn-xl sq', 'aria-label': tr('Hinzufügen'), onclick: openAddSheet, html: I.plus }),
        el('button', { type: 'button', class: 'btn btn-primary btn-xl', onclick: () => openPad({ via: 'bar', who: nxt }), html: I.pen + '<span>' + tr('Jetzt unterschreibt {name}', { name: personSubj(nxt) }) + '</span>' }));
    } else if (!S.items.some(i => i.type === 'sig')) {
      row.append(
        el('button', { type: 'button', class: 'btn btn-ghost btn-xl sq', 'aria-label': tr('Hinzufügen'), onclick: openAddSheet, html: I.plus }),
        el('button', { type: 'button', class: 'btn btn-primary btn-xl', onclick: insertSigAgain, html: I.pen + '<span>' + tr('Unterschrift einsetzen') + '</span>' }));
    } else {
      row.append(
        el('button', { type: 'button', class: 'btn btn-ghost btn-xl sq', 'aria-label': tr('Hinzufügen'), onclick: openAddSheet, html: I.plus }),
        el('button', { type: 'button', class: 'btn btn-primary btn-xl', onclick: finish, html: I.check + '<span>' + (backMode() ? tr('Fertig – Dokument senden') : tr('Fertig – PDF erstellen')) + '</span>' }));
    }
    bar.append(row);
  }

  /* ---------------- Absender: Stellen markieren und senden ---------------- */
  function addSpot(k) {
    const pi = S.cur, pg = S.pages[pi];
    const w = k === 's' ? 170 : 120, h = k === 's' ? 46 : 20;
    const sp = { id: nid(), type: 'spot', k: k, page: pi, w: w, h: h, x: clamp(pg.W * 0.1, 0, pg.W - w), y: clamp(visibleCenterPt(pg) - h / 2, 0, pg.H - h) };
    S.spots.push(sp);
    renderSpot(sp);
    select(sp);
    S.dirty = true;
    toast(k === 's' ? 'Feld auf die Unterschriftslinie ziehen.' : 'Feld auf die Stelle für Ort und Datum ziehen.');
  }

  function loadSender() { try { return JSON.parse(localStorage.getItem(LS_SENDER)) || {}; } catch (e) { return {}; } }
  function saveSender(o) { try { localStorage.setItem(LS_SENDER, JSON.stringify(o)); } catch (e) { /* egal */ } }
  function baseUrl() { return location.href.split('#')[0].split('?')[0]; }

  // Stelle: [Art, Seite, x, y, Breite, Höhe], dazu 1 bei Feldern der zweiten Person
  const spotRow = (sp, off) => [sp.k, sp.page + 1 - (off || 0), Math.round(sp.x), Math.round(sp.y), Math.round(sp.w), Math.round(sp.h)].concat(sp.who === 1 ? [1] : []);
  const spotList = () => S.spots.map(sp => spotRow(sp));
  // Titel des Dokuments (Absender): aus dem Dateinamen, auf Wunsch geändert
  const partTitle = p => docTitleOf(p.name);
  const defTitle = () => S.parts && S.parts.length ? partTitle(S.parts[0]) : docTitleOf(S.file ? S.file.name : '');
  const sendTitle = () => cleanLabel(S.docTitle).slice(0, 80) || defTitle();
  // Angaben zur Anfrage: Stellen, Absender, Sprache, Anrede (bei kurzen Links verschlüsselt beim Server, sonst im Link).
  // priv (Namen zum Vorausfüllen, Titel, Teile) nur in verschlüsselten Angaben oder vor Ort – nie in einem Link.
  function requestInfo(name, proof, back, priv) {
    const o = { v: 1, p: S.pages.length, s: spotList() };
    if (S.file.hash) o.h = S.file.hash.slice(0, 16);
    if (name) o.f = name.slice(0, 60);
    const zusatz = loadSender().sub;
    if (name && zusatz) o.z = String(zusatz).slice(0, 60);
    if (!proof) o.n = 0;
    if (back) o.b = 1;
    if (S.sendLang === 'sq') o.l = 'sq';
    if (S.sendDu) o.u = 1;
    if (priv) {
      if (priv.c) o.c = String(priv.c).slice(0, 80);
      if (priv.c2) o.c2 = String(priv.c2).slice(0, 80);
      o.ti = sendTitle();
      if (S.parts.length > 1) o.q = S.parts.map(p => [partTitle(p).slice(0, 60), p.pages]);
    }
    return o;
  }
  function requestLink(name, proof, withDoc) {
    if (withDoc && S.sent && S.sent.secret) return baseUrl() + '#' + S.sent.secret; // kurz: alles Weitere steckt verschlüsselt beim Server
    const o = requestInfo(name, proof, false);
    if (withDoc && S.sent) { o.d = S.sent.id; o.k = S.sent.key; o.t = S.sent.del; if (S.sent.track) o.b = 1; }
    return baseUrl() + '#r=' + toB64url(JSON.stringify(o));
  }

  // Nachrichten an den Kunden: ohne Begrüßung (es wird meist schon vorher geschrieben), Du oder Sie, Dank am Schluss
  function msgThanks(lang, du) {
    return lang === 'sq' ? (du ? 'Faleminderit për besimin tënd!' : 'Faleminderit për besimin tuaj!')
      : (du ? 'Vielen Dank für dein Vertrauen!' : 'Vielen Dank für Ihr Vertrauen!');
  }
  function msgValid(lang, expires) {
    if (!expires) return '';
    return lang === 'sq' ? 'Linku është i vlefshëm deri më ' + fmtDate(new Date(expires)) + '.\n\n' : 'Der Link ist bis ' + fmtDate(new Date(expires)) + ' gültig.\n\n';
  }
  const sign = name => name ? '\n' + name : '';

  function sendMessage(link, name) {
    const sq = S.sendLang === 'sq', du = S.sendDu;
    if (sq) {
      return (du ? 'Ja dokumenti yt për ta nënshkruar. Bëhet direkt në telefon:\n\n' +
          '1. Preke PDF-në dhe ruaje (iPhone: „Teilen“ → „In Dateien sichern“)\n2. Hape këtë link:\n' + link + '\n3. Zgjidhe PDF-në, nënshkruaje dhe ma dërgo përsëri këtu.\n\n'
        : 'Ja dokumenti juaj për ta nënshkruar. Bëhet direkt në telefon:\n\n' +
          '1. Prekni PDF-në dhe ruajeni (iPhone: „Teilen“ → „In Dateien sichern“)\n2. Hapni këtë link:\n' + link + '\n3. Zgjidhni PDF-në, nënshkruajeni dhe ma dërgoni përsëri këtu.\n\n') +
        msgThanks('sq', du) + sign(name);
    }
    return (du ? 'Hier ist dein Dokument zum Unterschreiben. Das geht direkt auf dem Handy:\n\n' : 'Hier ist Ihr Dokument zum Unterschreiben. Das geht direkt auf dem Handy:\n\n') +
      '1. Das PDF antippen und speichern (iPhone: Teilen → „In Dateien sichern“)\n' +
      '2. Diesen Link öffnen:\n' + link + '\n' +
      '3. Das PDF auswählen, unterschreiben und mir hier zurückschicken.\n\n' +
      msgThanks('de', du) + sign(name);
  }

  function linkMessage(link, name, expires, back) {
    const sq = S.sendLang === 'sq', du = S.sendDu;
    let intro;
    if (sq) {
      intro = du
        ? (back ? 'Ja dokumenti yt për ta nënshkruar. Hape linkun dhe nënshkruaje me gisht, pastaj më vjen automatikisht:' : 'Ja dokumenti yt për ta nënshkruar. Hape linkun, nënshkruaje me gisht dhe ma dërgo përsëri këtu:')
        : (back ? 'Ja dokumenti juaj për ta nënshkruar. Hapeni linkun dhe nënshkruajeni me gisht, pastaj më vjen automatikisht:' : 'Ja dokumenti juaj për ta nënshkruar. Hapeni linkun, nënshkruajeni me gisht dhe ma dërgoni përsëri këtu:');
    } else {
      intro = du
        ? (back ? 'Hier ist dein Dokument zum Unterschreiben. Öffne einfach den Link und unterschreib mit dem Finger, danach kommt es automatisch bei mir an:' : 'Hier ist dein Dokument zum Unterschreiben. Öffne einfach den Link, unterschreib mit dem Finger und schick es mir hier zurück:')
        : (back ? 'Hier ist Ihr Dokument zum Unterschreiben. Öffnen Sie einfach den Link und unterschreiben Sie mit dem Finger, danach kommt es automatisch bei mir an:' : 'Hier ist Ihr Dokument zum Unterschreiben. Öffnen Sie einfach den Link, unterschreiben Sie mit dem Finger und schicken Sie es mir hier zurück:');
    }
    return intro + '\n' + link + '\n\n' + msgThanks(sq ? 'sq' : 'de', du) + sign(name);
  }

  async function openSendSheet() {
    select(null);
    busy('Einen Moment …');
    // Kundenname aus dem PDF: läuft er noch, kurz darauf warten (höchstens 2 Sekunden)
    const guessWait = S.custGuessP ? Promise.race([S.custGuessP, new Promise(r => setTimeout(r, 2000))]) : null;
    const srv = (await Promise.all([serverStatus(), guessWait]))[0];
    unbusy();
    const cfg = loadSender();
    const nS = S.spots.filter(s => s.k === 's').length, nD = S.spots.filter(s => s.k === 'd').length;
    const nS2 = S.spots.filter(s => s.k === 's' && s.who === 1).length, two = nS2 > 0;
    let way = S.sent ? 'link' : S.intent === 'local' ? 'local' : 'link';
    const isLocal = () => way === 'local';

    // Absender: steht im Briefkopf beim Kunden
    const name = el('input', { class: 'in', type: 'text', value: cfg.name || '', placeholder: 'z. B. Max Muster', autocomplete: 'name', maxlength: '60' });
    const nameBox = el('label', { class: 'fld' }, el('span', { text: 'Ihr Name (sieht der Kunde)' }), name);
    // Kunde: Name (Übersicht, auf Wunsch beim Unterschreiben vorausgefüllt) und Notiz (nur Übersicht)
    // Name aus dem PDF vorschlagen (einmal; danach gilt, was eingetragen ist). Der Hinweis bleibt, solange der Name unverändert ist.
    const g = S.custGuess;
    if (g && !g.used && !S.custLabel) { g.used = true; S.custLabel = g.name; }
    const guess = g && g.used && S.custLabel === g.name ? g.name : '';
    const cust = el('input', { id: 'custName', class: 'in', type: 'text', value: S.custLabel || '', placeholder: 'z. B. Max Mustermann', autocomplete: 'off', autocapitalize: 'words', maxlength: '80' });
    const custHint = guess ? el('small', { class: 'guess', html: I.check + '<span>Aus dem PDF übernommen. Bitte kurz prüfen.</span>' }) : null;
    const prefill = el('input', { id: 'prefill', type: 'checkbox' });
    prefill.checked = cfg.prefill !== false;
    // Zweite Person (z. B. Ehepartner): nur wenn Felder für sie markiert sind
    const cust2 = el('input', { id: 'custName2', class: 'in', type: 'text', value: S.custLabel2 || '', placeholder: 'z. B. Maria Mustermann', autocomplete: 'off', autocapitalize: 'words', maxlength: '80' });
    const prefillRow = el('label', { class: 'check tight' }, prefill, el('span', { text: two ? 'Namen beim Unterschreiben schon eintragen' : 'Name beim Unterschreiben schon eintragen' }));
    const note = el('input', { id: 'custNote', class: 'in', type: 'text', value: S.custNote || '', placeholder: 'z. B. Rückruf am Montag', autocomplete: 'off', maxlength: '80' });
    const custBox = el('div', null,
      el('label', { class: 'fld' }, el('span', { text: 'Kunde' }), cust, custHint),
      two ? el('label', { class: 'fld' }, el('span', { text: '2. Person (unterschreibt die blauen Felder)' }), cust2) : null,
      prefillRow,
      el('label', { class: 'fld' }, el('span', { text: 'Notiz (optional, nur für Sie)' }), note));
    // Nur in verschlüsselten Angaben bzw. vor Ort: Namen zum Vorausfüllen
    const privInfo = () => ({ c: prefill.checked ? cleanLabel(cust.value) : '', c2: two && prefill.checked ? cleanLabel(cust2.value) : '' });
    // Titel des Dokuments: sieht der Kunde, steht im Dateinamen des unterschriebenen PDFs
    const docIn = el('input', { id: 'docTitle', class: 'in', type: 'text', value: sendTitle(), maxlength: '80', autocomplete: 'off', autocapitalize: 'sentences' });
    const fnHint = el('small');
    const docBox = el('label', { class: 'fld' }, el('span', { text: 'Dokument (sieht Ihr Kunde)' }), docIn, fnHint);
    const updFn = () => {
      fnHint.textContent = 'Das unterschriebene PDF heißt dann „' + signedName(sendTitle(), cleanLabel(cust.value) || 'Max Mustermann', two ? cleanLabel(cust2.value) : '', new Date()) + '“.';
    };

    const proof = el('input', { type: 'checkbox' });
    proof.checked = cfg.proof !== false;
    const langBtns = ['de', 'sq'].map(l => el('button', { type: 'button', class: 'seg' + (S.sendLang === l ? ' on' : ''), 'aria-pressed': S.sendLang === l ? 'true' : 'false', text: l === 'de' ? 'Deutsch' : 'Shqip',
      onclick: () => {
        S.sendLang = l;
        langBtns.forEach((b, i) => { const on = ['de', 'sq'][i] === l; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        edited = false;
        refresh(true);
      } }));
    const duBtns = [true, false].map(v => el('button', { type: 'button', class: 'seg' + (S.sendDu === v ? ' on' : ''), 'aria-pressed': S.sendDu === v ? 'true' : 'false', text: v ? 'Du' : 'Sie',
      onclick: () => {
        S.sendDu = v;
        duBtns.forEach((b, i) => { const on = [true, false][i] === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        edited = false;
        refresh(true);
      } }));
    const langHint = el('small');
    const langRow = el('div', { class: 'fld' }, el('span', { text: 'Sprache und Anrede' }),
      el('div', { class: 'segpair' }, el('div', { class: 'segrow' }, langBtns[0], langBtns[1]), el('div', { class: 'segrow' }, duBtns[0], duBtns[1])),
      langHint);
    const viaLink = el('input', { type: 'checkbox' });
    viaLink.checked = srv.ok && cfg.viaLink !== false;
    const viaHint = el('small');
    const viaRow = el('label', { class: 'check' }, viaLink, el('span', null, 'Dokument im Link mitschicken', viaHint));
    const proofRow = el('label', { class: 'check' }, proof, el('span', null, 'Nachweisseite anhängen', el('small', { text: 'Eine Seite mit Name, Zeitpunkt und Prüfsumme kommt ans Ende. Damit lässt sich zeigen, wer was wann unterschrieben hat.' })));
    const pinIn = el('input', { class: 'in', type: 'password', placeholder: 'mindestens 6 Zeichen', autocomplete: 'current-password', maxlength: '64' });
    const pinBox = el('label', { class: 'fld' }, el('span', { text: srv.pin ? 'Ihre Absender-PIN' : 'Absender-PIN festlegen' }), pinIn,
      el('small', { text: srv.pin ? 'Einmal eingeben, dieses Gerät merkt sie sich.' : 'Schützt Ihren Speicher: Nur mit dieser PIN können Dokumente hochgeladen werden. Dieses Gerät merkt sie sich.' }));

    // Vorlage: Felder für dieses Formular merken (oder eine angewendete Vorlage aktualisieren).
    // Bei mehreren PDFs bekommt jedes PDF seine eigene Vorlage.
    const multi = S.parts.length > 1, todo = tplTodo(), one = todo.length === 1 ? todo[0] : -1;
    const tplChanged = () => tplTodo().length > 0;
    const curTpl = one >= 0 ? tplOfPart(one) : null;
    const tplOn = el('input', { id: 'tplOn', type: 'checkbox' });
    const tplName = el('input', { id: 'tplName', class: 'in', type: 'text', value: defaultTplName(), maxlength: '50', autocomplete: 'off' });
    const tplNameBox = el('label', { class: 'fld' }, el('span', { text: 'Name der Vorlage' }), tplName);
    const tplRow = el('label', { class: 'check' }, tplOn, el('span', null,
      curTpl ? 'Vorlage „' + curTpl.name + '“ mit diesen Feldern aktualisieren'
        : !multi ? 'Felder als Vorlage merken'
          : one >= 0 ? 'Felder von „' + partTitle(S.parts[one]) + '“ als Vorlage merken' : 'Felder als Vorlagen merken (' + todo.length + ' PDFs)',
      el('small', { text: curTpl ? 'Beim nächsten Mal werden die Felder so gesetzt wie jetzt.'
        : !multi ? 'Kommt dieses Formular wieder, setzt Firmio die Felder automatisch.'
          : 'Jedes PDF bekommt seine eigene Vorlage. Kommt eins davon wieder, setzt Firmio seine Felder automatisch.' })));
    const tplBox = el('div', null, tplRow, tplNameBox);
    tplOn.addEventListener('change', () => render());
    let tplDone = false;
    const maybeSaveTpl = async () => {
      if (tplDone || !tplOn.checked || !tplChanged()) return;
      tplDone = true;
      if (!(await saveTemplates(!multi && !S.tpl ? (cleanLabel(tplName.value) || defaultTplName()) : ''))) toast('Die Vorlage konnte nicht gespeichert werden.');
    };

    const onCust = () => {
      if (custHint && cust.value !== guess) custHint.remove();
      S.custLabel = cust.value;
      S.custLabel2 = cust2.value;
      S.custNote = note.value;
      if (S.sent && S.sent.track) Store.patch(S.sent.id, { label: cleanLabel(cust.value), label2: two ? cleanLabel(cust2.value) : '', note: cleanLabel(note.value) }).catch(() => {});
      pushHead();
      updFn();
    };
    cust.addEventListener('input', onCust);
    cust2.addEventListener('input', onCust);
    note.addEventListener('input', onCust);
    docIn.addEventListener('input', () => {
      S.docTitle = docIn.value;
      updFn();
      pushHead();
      if (S.sent && S.sent.track) Store.patch(S.sent.id, { title: sendTitle() }).catch(() => {});
    });
    docIn.addEventListener('change', () => { if (!cleanLabel(docIn.value)) { S.docTitle = ''; docIn.value = sendTitle(); updFn(); } });
    prefill.addEventListener('change', () => { saveSender(Object.assign(loadSender(), { prefill: prefill.checked })); pushHead(); });
    const err = el('p', { class: 'err', role: 'alert' });
    const msg = el('textarea', { class: 'in', rows: '9' });
    const msgBox = el('label', { class: 'fld' }, el('span', { text: 'Nachricht an den Kunden' }), msg);
    let edited = false, link = '';
    const linkMode = () => !isLocal() && srv.ok && viaLink.checked;
    const willTrack = () => S.sent ? !!S.sent.track : (srv.v || 1) >= 2 && S.inbox.ok;
    const currentLink = () => linkMode() ? (S.sent ? requestLink(name.value.trim(), proof.checked, true) : LINK_PLACEHOLDER) : requestLink(name.value.trim(), proof.checked, false);
    const template = l => linkMode() ? linkMessage(l, name.value.trim(), S.sent && S.sent.expires, willTrack()) : sendMessage(l, name.value.trim());
    // Kurzer Link: Ändert sich Sprache, Anrede, Name, Kunde oder Nachweisseite, werden die verschlüsselten Angaben beim Server erneuert
    let headTimer = 0;
    const pushHead = () => {
      if (!S.sent || !S.sent.secret || !S.file) return;
      const sent = S.sent;
      const info = requestInfo(name.value.trim(), proof.checked, !!sent.track, privInfo()); // jetzt erfassen, solange das Dokument offen ist
      const sig = JSON.stringify(info);
      clearTimeout(headTimer);
      if (sig === sent.headSig) return;
      headTimer = setTimeout(async () => {
        try {
          await apiFetch('PUT', '/api/doc/' + sent.id + '/head', { pin: getPin(), json: { head: await sealHead(info, sent.key) } });
          sent.headSig = sig;
        } catch (e) { console.warn('Angaben aktualisieren:', e); }
      }, 350);
    };
    const refresh = (force) => {
      if (!isLocal()) {
        pushHead();
        const nl = currentLink();
        if (edited && !force && link) msg.value = msg.value.split(link).join(nl);
        else msg.value = template(nl);
        link = nl;
        if (S.sent && S.sent.track && linkMode()) Store.patch(S.sent.id, { link: nl, lang: S.sendLang, du: S.sendDu }).catch(() => {});
      }
      saveSender(Object.assign(loadSender(), { name: name.value.trim(), proof: proof.checked, viaLink: viaLink.checked })); // Anrede gilt nur für diese Anfrage
      render();
    };
    name.addEventListener('input', () => refresh(false));
    proof.addEventListener('change', () => refresh(false));
    viaLink.addEventListener('change', () => { edited = false; refresh(true); });
    msg.addEventListener('input', () => { edited = true; });

    const summary = (nS || nD
      ? (nS ? nS + ' ' + plural(nS, 'Unterschriftsfeld', 'Unterschriftsfelder') + (nS2 ? ' (davon ' + nS2 + ' für die 2. Person)' : '') : '') + (nS && nD ? ' und ' : '') + (nD ? nD + ' ' + plural(nD, 'Ort/Datum-Feld', 'Ort/Datum-Felder') : '') + ' markiert.'
      : 'Keine Felder markiert. Der Kunde setzt die Unterschrift dann selbst an die richtige Stelle.') + ' ' + S.pages.length + ' ' + plural(S.pages.length, 'Seite', 'Seiten') +
      (multi ? ' aus ' + S.parts.length + ' PDFs' : '') + '.' +
      (S.own.length ? ' Ihre eigene Unterschrift ist gesetzt.' : '') +
      (S.tpl && !multi && !tplChanged() ? ' Vorlage „' + S.tpl.name + '“.' : '');

    const wayBtns = [['link', I.link, 'Per Link'], ['local', I.phone, 'Hier vor Ort']].map(w => el('button', { type: 'button', class: 'seg', html: w[1] + '<span>' + w[2] + '</span>',
      onclick: () => { if (S.sent || way === w[0]) return; way = w[0]; S.intent = way; err.textContent = ''; edited = false; refresh(true); } }));
    const waySel = el('div', { class: 'segrow waysel', role: 'group', 'aria-label': 'Wie soll unterschrieben werden?' }, wayBtns[0], wayBtns[1]);
    const localInfo = el('div', { class: 'banner' }, el('span', { html: I.phone }),
      el('p', { text: 'Ihr Kunde unterschreibt gleich hier auf diesem Handy. Das unterschriebene PDF landet direkt in Ihrer Übersicht – ohne Upload, auch ohne Internet.' }));
    const more = el('details', { class: 'more' }, el('summary', { text: 'Weitere Optionen' }));
    if (cfg.name) more.append(nameBox);
    more.append(viaRow, proofRow);

    const actions = el('div');
    const linkInfo = el('div');

    async function createLink() {
      err.textContent = '';
      const pin = getPin() || pinIn.value.trim();
      if (pin.length < 6) { err.textContent = 'Bitte eine PIN mit mindestens 6 Zeichen eingeben.'; pinIn.focus(); return; }
      busy('PIN wird geprüft …');
      try {
        await apiJSON('POST', '/api/pin', { json: { pin: pin } });
        setPin(pin);
        srv.pin = true;
        await maybeSaveTpl(); // vor dem Einsetzen der eigenen Unterschrift, damit die Vorlage deren Lage kennt
        if (S.own.length) {
          try { await burnOwn(); } catch (x) { unbusy(); err.textContent = 'Ihre Unterschrift konnte nicht eingesetzt werden. Bitte noch einmal versuchen.'; return; }
        }
        busy('Dokument wird verschlüsselt …');
        const back = willTrack();
        S.sent = await uploadDoc(pin, p => busy('Wird hochgeladen … ' + Math.round(p * 100) + ' %'), requestInfo(name.value.trim(), proof.checked, back, privInfo()));
        S.sent.track = false;
        if ((srv.v || 1) >= 2) {
          // In der Übersicht merken (nur auf diesem Gerät). Dann kommt das PDF direkt hierher zurück.
          try {
            await Store.put({ id: S.sent.id, key: S.sent.key, del: S.sent.del, secret: S.sent.secret || '', label: cleanLabel(cust.value), label2: two ? cleanLabel(cust2.value) : '', note: cleanLabel(note.value),
              file: S.file.name, title: sendTitle(), parts: S.parts.length, pages: S.pages.length,
              created: Date.now(), expires: S.sent.expires, lang: S.sendLang, du: S.sendDu, status: 'open', link: '', tpl: S.tpl ? S.tpl.id : '' });
            S.sent.track = true;
            S.dirty = false;
            askPersist();
          } catch (x) { console.warn('Übersicht nicht verfügbar:', x); }
        }
        if (S.sent.secret && back && !S.sent.track) pushHead(); // Übersicht ging nicht: Kunde schickt dann per WhatsApp zurück
        decoratePages(); // jetzt kein Anhängen oder Entfernen mehr
        unbusy();
        refresh(false);
        setTimeout(() => { try { actions.scrollIntoView({ block: 'end', behavior: 'smooth' }); } catch (x) { /* egal */ } }, 60);
        toast('Link erstellt. Jetzt per WhatsApp senden.');
      } catch (e) {
        unbusy();
        if (e.code === 'pin_wrong') { setPin(''); err.textContent = 'Die PIN stimmt nicht.'; render(); }
        else if (e.code === 'pin_short') err.textContent = 'Die PIN muss mindestens 6 Zeichen haben.';
        else if (e.code === 'too_large' || e.code === 'http_413') err.textContent = 'Das Dokument ist zu groß für den Link. Schalten Sie unter „Weitere Optionen“ „Dokument im Link mitschicken“ aus und senden Sie das PDF als Anhang.';
        else err.textContent = 'Hochladen hat nicht geklappt. Bitte Internetverbindung prüfen und noch einmal versuchen.';
      }
    }

    async function goLocal() {
      err.textContent = '';
      await maybeSaveTpl();
      if (S.own.length) {
        try { await burnOwn(); } catch (x) { err.textContent = 'Ihre Unterschrift konnte nicht eingesetzt werden. Bitte noch einmal versuchen.'; return; }
      }
      saveSender(Object.assign(loadSender(), { name: name.value.trim(), proof: proof.checked, prefill: prefill.checked }));
      startLocal({ label: cleanLabel(cust.value), label2: two ? cleanLabel(cust2.value) : '', note: cleanLabel(note.value), info: requestInfo(name.value.trim(), proof.checked, false, privInfo()) });
    }

    async function shareText() {
      await maybeSaveTpl();
      if (await shareMessage(msg.value)) S.dirty = false;
    }

    // Ohne Server-Teil: erst die eigene Unterschrift einsetzen (danach ein zweiter Tipp, weil Teilen einen frischen Tipp braucht)
    async function burnFirst() {
      if (!S.own.length) return false;
      await maybeSaveTpl();
      try { await burnOwn(); } catch (x) { toast('Ihre Unterschrift konnte nicht eingesetzt werden.'); return true; }
      refresh(false);
      toast('Ihre Unterschrift ist eingesetzt. Bitte noch einmal tippen.', 4000);
      return true;
    }
    async function shareWithPdf() {
      if (await burnFirst()) return;
      await maybeSaveTpl();
      const file = new File([S.file.bytes], S.file.name, { type: 'application/pdf' });
      const data = { files: [file], text: msg.value };
      if (navigator.canShare && navigator.share && navigator.canShare(data)) {
        try {
          await navigator.share(data);
          S.dirty = false;
          toast('Falls der Text in WhatsApp fehlt: „Text kopieren“ tippen und einfügen.', 5200);
        } catch (e) {
          if (!e || e.name !== 'AbortError') toast('Teilen hat nicht geklappt. Nutzen Sie „PDF speichern“ und „Text kopieren“.', 5000);
        }
      } else {
        download(S.file.bytes, S.file.name);
        copyText(msg.value);
        toast('PDF gespeichert und Nachricht kopiert. Beides in WhatsApp an den Kunden senden.', 5200);
      }
    }

    function render() {
      const loc = isLocal(), lm = linkMode();
      wayBtns.forEach((b, i) => { const on = (i === 1) === loc; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      waySel.classList.toggle('hidden', !!S.sent);
      setText('#sheetTitle', loc ? 'Vor Ort unterschreiben' : 'Per WhatsApp senden');
      custBox.classList.toggle('hidden', !(loc || (lm && willTrack())));
      prefillRow.classList.toggle('hidden', !(loc || (lm && shortLinks())));
      docBox.classList.toggle('hidden', !(loc || (lm && shortLinks())));
      langHint.textContent = loc ? 'So sieht Ihr Kunde die Seite zum Unterschreiben. Die Nachweisseite im PDF bleibt Deutsch.'
        : 'So sieht Ihr Kunde die Nachricht und die Seite zum Unterschreiben. Die Nachweisseite im PDF bleibt Deutsch.';
      viaRow.classList.toggle('hidden', loc || !srv.ok || !!S.sent);
      viaHint.textContent = willTrack()
        ? 'Ihr Kunde muss nichts speichern und nichts zurückschicken: Er unterschreibt über den Link, das PDF landet direkt in Ihrer Übersicht. Ende-zu-Ende verschlüsselt.'
        : 'Ihr Kunde muss nichts speichern: Er tippt auf den Link und das Dokument ist da. Ende-zu-Ende verschlüsselt, nach dem Zurückschicken bzw. nach 7 Tagen gelöscht.';
      tplBox.classList.toggle('hidden', tplDone || !tplChanged());
      tplNameBox.classList.toggle('hidden', !tplOn.checked || !!S.tpl || multi);
      localInfo.classList.toggle('hidden', !loc);
      msgBox.classList.toggle('hidden', loc);
      pinBox.classList.toggle('hidden', !lm || !!S.sent || !!getPin());
      actions.innerHTML = '';
      linkInfo.innerHTML = '';
      if (loc) {
        actions.append(el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.pen + '<span>Jetzt unterschreiben lassen</span>', onclick: goLocal }));
      } else if (lm && !S.sent) {
        actions.append(el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.check + '<span>Link erstellen</span>', onclick: createLink }));
      } else if (lm) {
        linkInfo.append(el('div', { class: 'banner' }, el('span', { html: I.check }),
          el('p', { text: S.sent.track
            ? 'Link erstellt. Sobald Ihr Kunde unterschrieben hat, finden Sie das PDF in Ihrer Übersicht unter „Erledigt“.'
            : 'Link erstellt. Das Dokument liegt verschlüsselt bereit, bis ' + fmtDate(new Date(S.sent.expires)) + ' oder bis Ihr Kunde es zurückgeschickt hat.' })));
        actions.append(el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.share + '<span>Per WhatsApp senden</span>', onclick: shareText }),
          el('div', { class: 'btnrow' },
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.copy + '<span>Text kopieren</span>', onclick: () => copyText(msg.value, 'Nachricht kopiert.') }),
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.copy + '<span>Link kopieren</span>', onclick: () => copyText(link, 'Link kopiert.') })),
          el('div', { class: 'donelinks' },
            S.sent.track ? el('button', { type: 'button', class: 'linkbtn strong', text: 'Zur Übersicht', onclick: () => { closeSheet(true); history.back(); } }) : null,
            el('a', { class: 'linkbtn', href: '#', text: 'Link als Kunde testen', onclick: e => { e.preventDefault(); window.open(previewLink(link), '_blank', 'noopener'); } })));
      } else {
        actions.append(el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.share + '<span>PDF + Nachricht senden</span>', onclick: shareWithPdf }),
          el('div', { class: 'btnrow' },
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.copy + '<span>Text kopieren</span>', onclick: () => copyText(msg.value, 'Nachricht kopiert.') }),
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.download + '<span>PDF speichern</span>', onclick: async () => { if (!(await burnFirst())) download(S.file.bytes, S.file.name); } })),
          el('div', { class: 'donelinks' },
            el('a', { class: 'linkbtn', href: '#', text: 'Link als Kunde testen', onclick: e => { e.preventDefault(); window.open(previewLink(link), '_blank', 'noopener'); } })));
      }
    }

    const body = el('div', null,
      el('div', { class: 'banner' + (nS ? '' : ' warn') }, el('span', { html: nS ? I.check : I.info }), el('p', { text: summary })),
      waySel,
      custBox,
      docBox,
      cfg.name ? null : nameBox,
      langRow,
      tplBox,
      localInfo,
      pinBox,
      linkInfo,
      msgBox,
      more,
      err,
      actions);
    updFn();
    openSheet(isLocal() ? 'Vor Ort unterschreiben' : 'Per WhatsApp senden', body);
    refresh(true);
  }

  function copyText(text, okMsg) {
    const done = () => { if (okMsg) toast(okMsg); };
    const fallback = () => {
      const ta = el('textarea', { readonly: 'readonly' });
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Kopieren hat nicht geklappt. Bitte Text markieren und kopieren.'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = el('a', { href: url, download: name });
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Text teilen (WhatsApp & Co.), sonst wa.me öffnen. true = geteilt bzw. geöffnet
  async function shareMessage(text) {
    if (navigator.share) {
      try { await navigator.share({ text: text }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    return true;
  }
  // PDF teilen, sonst herunterladen
  async function shareFile(bytes, name) {
    let file = null;
    try { file = new File([bytes], name, { type: 'application/pdf' }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    download(bytes, name);
    toast('PDF wird gespeichert.');
  }

  /* ---------------- Vorlagen: Felder für wiederkehrende Formulare (nur auf diesem Gerät) ---------------- */
  const LS_TPL = 'firmio.vorlagen.v1';
  function loadTpls() {
    try {
      const a = JSON.parse(localStorage.getItem(LS_TPL));
      return Array.isArray(a) ? a.filter(t => t && typeof t.id === 'string' && Array.isArray(t.spots) && Array.isArray(t.sizes)) : [];
    } catch (e) { return []; }
  }
  function saveTpls(list) {
    try { localStorage.setItem(LS_TPL, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  function defaultTplName() {
    return String(S.file ? S.file.name : '').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'Formular';
  }
  // Wörter der ersten Seiten nur als kurze Prüfsummen merken: kein Klartext, keine Kundendaten im Speicher
  function wordHash(w) {
    let h = 0x811c9dc5;
    for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  // Fingerabdruck eines Formulars: Seitenzahl, Seitenformate, Wörter.
  // own = Formate aus dem PDF selbst lesen (für ein angehängtes PDF, das noch nicht angezeigt wird)
  async function docSig(pdf, own) {
    let sizes;
    if (own) {
      sizes = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 60); i++) {
        const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
        sizes.push([Math.round(vp.width), Math.round(vp.height)]);
      }
    } else sizes = S.pages.slice(0, 60).map(p => [Math.round(p.W), Math.round(p.H)]);
    const words = [], seen = new Set();
    for (let i = 1; i <= Math.min(pdf.numPages, 4) && words.length < 800; i++) {
      try {
        const tc = await (await pdf.getPage(i)).getTextContent();
        for (const it of tc.items) {
          for (const w of fold(it.str || '').split(/[^a-z0-9]+/)) {
            if (w.length < 4 || /^\d+$/.test(w)) continue;
            const h = wordHash(w);
            if (!seen.has(h)) { seen.add(h); words.push(h); }
            if (words.length >= 800) break;
          }
          if (words.length >= 800) break;
        }
      } catch (e) { /* Seite ohne Text (z. B. eingescannt) */ }
    }
    return { pages: own ? pdf.numPages : S.pages.length, sizes: sizes, words: words };
  }
  // Ähnlichkeit 0…1 (Jaccard über die Wörter), -1 = passt nicht (andere Seitenzahl oder anderes Format)
  function tplScore(t, sig) {
    if (t.pages !== sig.pages) return -1;
    for (let i = 0; i < Math.min(t.sizes.length, sig.sizes.length); i++) {
      if (Math.abs(t.sizes[i][0] - sig.sizes[i][0]) > 3 || Math.abs(t.sizes[i][1] - sig.sizes[i][1]) > 3) return -1;
    }
    const tw = Array.isArray(t.words) ? t.words : [];
    if (!tw.length && !sig.words.length) return 0.3; // eingescannt: nur Format bekannt, daher nur vorschlagen
    if (!tw.length || !sig.words.length) return 0;
    const a = new Set(tw);
    let inter = 0;
    sig.words.forEach(w => { if (a.has(w)) inter++; });
    return inter / (a.size + sig.words.length - inter);
  }
  const bestTpl = (list, sig) => list.map(t => ({ t: t, s: tplScore(t, sig) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s || (b.t.used || 0) - (a.t.used || 0));
  async function checkTemplates() {
    const list = loadTpls();
    if (!list.length || S.mode !== 'send' || S.view) return null;
    const pdf = S.pdf;
    const sig = await docSig(pdf);
    if (pdf !== S.pdf || S.mode !== 'send') return null;
    S.docSig = sig;
    if (S.parts.length === 1) S.parts[0].sig = sig;
    const scored = bestTpl(list, sig);
    if (!scored.length || S.spots.length || S.own.length) return null;
    const best = scored[0];
    if (best.s >= 0.45 && !S.sheetOpen) { applyTpl(best.t); return best.t; }
    if (best.s >= 0.45) banner('info', 'Sieht aus wie Ihre Vorlage „' + best.t.name + '“.', { label: 'Felder setzen', fn: () => applyTpl(best.t) });
    else if (best.s >= 0.2) banner('info', 'Sieht aus wie Ihre Vorlage „' + best.t.name + '“.', { label: 'Felder setzen', fn: () => applyTpl(best.t) });
    else banner('info', 'Tippen Sie unten auf „Unterschrift“ und ziehen Sie das gelbe Feld auf die Unterschriftslinie.', { label: 'Vorlage wählen', fn: () => pickTpl(scored.map(x => x.t)) });
    return null;
  }
  function pickTpl(list) {
    const body = el('div', { class: 'menu' });
    list.forEach(t => body.append(el('button', { type: 'button', onclick: () => { closeSheet(); setTimeout(() => applyTpl(t), 80); } },
      el('span', { class: 'ic', html: I.tpl }),
      el('span', null, el('b', { text: t.name }), el('small', { text: t.spots.length + ' ' + plural(t.spots.length, 'Feld', 'Felder') + ' · ' + t.pages + ' ' + plural(t.pages, 'Seite', 'Seiten') })))));
    openSheet('Vorlage wählen', body);
  }
  // Felder einer Vorlage auf Teil i setzen (bei einem einzelnen PDF: Teil 0 = alles)
  function placeTpl(t, i) {
    const r = partRange(i), ids = [];
    t.spots.forEach(a => {
      const pi = a[1] - 1 + r[0], pg = S.pages[pi];
      if (!pg || pi >= r[1] || (a[0] !== 's' && a[0] !== 'd')) return;
      const w = clamp(a[4], 12, pg.W), h = clamp(a[5], 8, pg.H);
      const sp = { id: nid(), type: 'spot', k: a[0], page: pi, x: clamp(a[2], 0, pg.W - w), y: clamp(a[3], 0, pg.H - h), w: w, h: h, who: a[0] === 's' && a[6] === 1 ? 1 : 0 };
      S.spots.push(sp);
      renderSpot(sp);
      ids.push(sp.id);
    });
    let nOwn = 0;
    if (S.mySig && Array.isArray(t.own)) {
      t.own.forEach(a => {
        if (!Array.isArray(a) || a.length !== 4 || !a.every(v => typeof v === 'number' && isFinite(v)) || a[0] - 1 + r[0] >= r[1]) return;
        const o = placeOwn(a[0] - 1 + r[0], a[1], a[2], a[3], false);
        if (o) { ids.push(o.id); nOwn++; }
      });
    }
    const ref = { id: t.id, name: t.name, ids: ids, sig: tplSigIn(i) };
    if (i === 0) S.tpl = ref; else S.parts[i].tpl = ref;
    const list = loadTpls(), x = list.find(v => v.id === t.id);
    if (x) { x.used = Date.now(); x.n = (x.n || 0) + 1; saveTpls(list); }
    S.dirty = true;
    return { ids: ids, nOwn: nOwn };
  }
  function applyTpl(t) {
    undoTpl(true);
    const res = placeTpl(t, 0), nF = res.ids.length - res.nOwn;
    banner('ok', 'Vorlage „' + t.name + '“: ' + nF + ' ' + plural(nF, 'Feld', 'Felder') + ' gesetzt' + (res.nOwn ? ', dazu Ihre Unterschrift' : '') + '. Bitte kurz prüfen.', { label: 'Rückgängig', fn: () => undoTpl() });
    renderBar();
    window.scrollTo(0, 0);
  }
  function undoTpl(silent) {
    if (!S.tpl) return;
    const ids = S.tpl.ids;
    S.spots.filter(sp => ids.indexOf(sp.id) >= 0).forEach(sp => removeObj(sp));
    S.own.filter(o => ids.indexOf(o.id) >= 0).forEach(o => removeObj(o));
    S.tpl = null;
    if (!silent) banner('info', 'Felder entfernt. Setzen Sie sie unten mit „Unterschrift“ und „Ort/Datum“.');
  }
  // Teile, deren Felder neu oder geändert sind (für „als Vorlage merken“)
  function tplTodo() {
    return S.parts.map((p, i) => i).filter(i => (spotListIn(i).length || ownListIn(i).length) && (!tplOfPart(i) || tplSigIn(i) !== tplOfPart(i).sig));
  }
  // Vorlagen speichern: je Teil eine (bei einem einzelnen PDF wie bisher genau eine). name: für eine neue Vorlage von Teil 0
  async function saveTemplates(name) {
    try {
      let list = loadTpls();
      for (const i of tplTodo()) {
        const p = S.parts[i], cur = tplOfPart(i);
        let sig = p.sig;
        if (!sig && S.parts.length === 1) sig = S.docSig || await docSig(S.pdf);
        if (!sig) continue; // Fingerabdruck fehlt (sollte nicht vorkommen)
        p.sig = sig;
        if (i === 0) S.docSig = sig;
        const spots = spotListIn(i), own = ownListIn(i);
        const old = cur ? list.find(t => t.id === cur.id) : null;
        if (old) {
          Object.assign(old, { spots: spots, own: own, sizes: sig.sizes, pages: sig.pages, words: sig.words.length ? sig.words : old.words, updated: Date.now(), used: Date.now() });
          cur.sig = tplSigIn(i);
        } else {
          const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: String(i === 0 && name ? name : partTitle(p)).slice(0, 50),
            pages: sig.pages, sizes: sig.sizes, words: sig.words, spots: spots, own: own, created: Date.now(), used: Date.now(), n: 1 };
          list.unshift(t);
          const ids = S.spots.filter(sp => inPart(sp, i)).map(x => x.id).concat(S.own.filter(o => inPart(o, i)).map(x => x.id));
          const ref = { id: t.id, name: t.name, ids: ids, sig: tplSigIn(i) };
          if (i === 0) S.tpl = ref; else p.tpl = ref;
        }
      }
      if (list.length > 40) list = list.sort((a, b) => (b.used || 0) - (a.used || 0)).slice(0, 40);
      return saveTpls(list);
    } catch (e) { console.warn('Vorlage:', e); return false; }
  }

  /* ---------------- Mehrere PDFs in einem Link (Absender): zusammenfügen, anhängen, wieder entfernen ---------------- */
  // PDF mit pdf.js öffnen (fragt bei Passwortschutz nach dem Passwort)
  function loadPdfJs(bytes) {
    if (!window.pdfjsLib) return Promise.reject(new Error('pdfjs'));
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const task = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
    task.onPassword = (update, reason) => {
      unbusy();
      const pw = prompt(reason === 2 ? tr('Falsches Passwort. Bitte noch einmal eingeben:') : tr('Das PDF ist mit einem Passwort geschützt. Bitte Passwort eingeben:'));
      if (pw === null) { task.destroy(); return; }
      busy(tr('Dokument wird geöffnet …'));
      update(pw);
    };
    return task.promise;
  }
  // Gewählte Dateien lesen und prüfen: [{ name, bytes, pdf, pages, sig }]
  async function readPdfs(files) {
    const list = [];
    for (const f of files.slice(0, 10)) {
      let bytes = null, pdf = null, sig = null;
      try { bytes = await readFile(f); } catch (e) { bytes = null; }
      if (!bytes || !looksLikePdf(bytes)) { unbusy(); alert('„' + f.name + '“ ist kein PDF und wird übersprungen.'); continue; }
      busy('PDF wird geöffnet …');
      try { pdf = await loadPdfJs(bytes); } catch (e) { unbusy(); alert('„' + f.name + '“ konnte nicht geöffnet werden und wird übersprungen.'); continue; }
      try { sig = await docSig(pdf, true); } catch (e) { sig = null; } // Fingerabdruck für Vorlagen
      list.push({ name: cleanName(f.name), bytes: bytes, pdf: pdf, pages: pdf.numPages, sig: sig });
    }
    return list;
  }
  const dropPdfs = list => list.forEach(a => { try { a.pdf.destroy(); } catch (e) { /* egal */ } });
  // Zu einem PDF zusammenfügen. Geschützte PDFs werden als Bild übernommen.
  async function mergePdfs(list) {
    const L = await loadPdfLib();
    const out = await L.PDFDocument.create();
    for (let k = 0; k < list.length; k++) {
      const it = list[k];
      busy('PDFs werden zusammengefügt … ' + (k + 1) + '/' + list.length);
      let src = null;
      try { src = await L.PDFDocument.load(it.bytes, { updateMetadata: false }); } catch (e) { src = null; }
      if (src && src.getPageCount() === it.pdf.numPages) (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
      else await rasterInto(L, out, it.pdf);
    }
    return out.save({ useObjectStreams: false });
  }
  const docNameText = () => S.parts.length > 1 ? partTitle(S.parts[0]) + ' + ' + (S.parts.length - 1) + ' ' + plural(S.parts.length - 1, 'weiteres', 'weitere') : S.file.name;
  // Neues PDF anzeigen; Felder und eigene Unterschrift bleiben, wo sie sind
  async function swapDoc(bytes) {
    const fresh = await loadPdfJs(bytes);
    const old = S.pdf;
    S.file = { name: S.file.name, bytes: bytes, hash: await sha256(bytes) };
    S.pdf = fresh;
    try { old.destroy(); } catch (e) { /* egal */ }
    S.sel = null;
    await buildPages();
    S.spots.forEach(renderSpot);
    S.own.forEach(o => renderItem(o));
    S.dirty = true;
    $('#docName').textContent = docNameText();
    renderBar();
    updateCur();
  }
  // Start: mehrere PDFs auf einmal gewählt
  async function openMany(files) {
    busy(tr('Dokument wird geöffnet …'));
    const list = await readPdfs(files);
    if (!list.length) { unbusy(); return; }
    if (list.length === 1) { dropPdfs(list); await openBytes(list[0].bytes, list[0].name, false); return; }
    let bytes;
    try { bytes = await mergePdfs(list); } catch (e) {
      console.error('Zusammenfügen:', e);
      dropPdfs(list);
      unbusy();
      alert('Die PDFs konnten nicht zusammengefügt werden.');
      return;
    }
    const parts = list.map(a => ({ name: a.name, pages: a.pages, sig: a.sig, tpl: null }));
    dropPdfs(list);
    await openBytes(bytes, list[0].name, false, parts);
  }
  // Im Dokument: weiteres PDF anhängen
  function pickMore() {
    if (S.sent) { toast('Der Link ist schon erstellt. Für weitere PDFs bitte eine neue Anfrage starten.', 4500); return; }
    const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, class: 'vh' });
    document.body.append(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      if (files.length) addPdfs(files);
    });
    input.addEventListener('cancel', () => input.remove());
    input.click();
  }
  async function addPdfs(files) {
    if (S.mode !== 'send' || S.view || !S.pdf || S.sent) return;
    busy('PDF wird angehängt …');
    const add = await readPdfs(files);
    if (!add.length) { unbusy(); return; }
    try {
      // Fingerabdruck des ersten PDFs vor dem Zusammenfügen merken (Vorlagen gelten je PDF)
      if (S.parts.length === 1 && !S.parts[0].sig) S.parts[0].sig = S.docSig || await docSig(S.pdf).catch(() => null);
      if (S.parts.length === 1) S.docSig = S.parts[0].sig;
      const first = S.parts.length, from = S.pages.length;
      const bytes = await mergePdfs([{ bytes: S.file.bytes, pdf: S.pdf }].concat(add));
      add.forEach(a => S.parts.push({ name: a.name, pages: a.pages, sig: a.sig, tpl: null }));
      dropPdfs(add);
      await swapDoc(bytes);
      unbusy();
      const to = S.pages.length;
      guessCustomerLater(); // falls bisher kein Name gefunden wurde
      await prepParts(first, (add.length === 1 ? '„' + partTitle(S.parts[first]) + '“ ist angehängt' : add.length + ' PDFs sind angehängt') +
        ' (' + (to - from === 1 ? 'Seite ' + to : 'Seite ' + (from + 1) + '–' + to) + ').');
      window.scrollTo(0, 0);
    } catch (e) {
      console.error('Anhängen:', e);
      dropPdfs(add);
      unbusy();
      alert('Das PDF konnte nicht angehängt werden.');
    }
  }
  // Teile wieder entfernen (ab Teil i, count Stück); Felder darauf verschwinden, spätere rücken nach vorn
  async function removeParts(i, count) {
    if (S.sent || i < 1 || i >= S.parts.length) return;
    count = Math.max(1, Math.min(count || 1, S.parts.length - i));
    const r0 = partRange(i)[0], r1 = partRange(i + count - 1)[1], n = r1 - r0;
    const names = S.parts.slice(i, i + count).map(p => '„' + partTitle(p) + '“').join(', ');
    if (!confirm(names + ' wieder entfernen? Die Felder darauf gehen verloren.')) return;
    busy('Einen Moment …');
    try {
      const L = await loadPdfLib();
      const src = await L.PDFDocument.load(S.file.bytes, { updateMetadata: false });
      const out = await L.PDFDocument.create();
      (await out.copyPages(src, src.getPageIndices().filter(k => k < r0 || k >= r1))).forEach(p => out.addPage(p));
      const bytes = await out.save({ useObjectStreams: false });
      S.spots.concat(S.own).filter(o => o.page >= r0 && o.page < r1).forEach(o => removeObj(o));
      S.spots.concat(S.own).forEach(o => { if (o.page >= r1) o.page -= n; });
      S.parts.splice(i, count);
      await swapDoc(bytes);
      unbusy();
      if (S.custGuess && !S.custGuess.used) S.custGuess = null; // Name stammte evtl. aus dem entfernten PDF
      guessCustomerLater();
      banner('info', names + ' ' + (count === 1 ? 'ist' : 'sind') + ' wieder entfernt.');
      window.scrollTo(0, 0);
    } catch (e) {
      console.error('Entfernen:', e);
      unbusy();
      alert('Das hat nicht geklappt. Bitte noch einmal versuchen.');
    }
  }
  // Teile ab first vorbereiten: passende Vorlage anwenden, sonst Felder erkennen. Ein gemeinsamer Hinweis oben.
  async function prepParts(first, intro) {
    const pdf = S.pdf, tpls = loadTpls(), ids = [], tplNames = [], ownWait = [];
    let nCust = 0, nOwn = 0, nTpl = 0;
    for (let i = first; i < S.parts.length; i++) {
      const p = S.parts[i];
      const best = p.sig && tpls.length ? bestTpl(tpls, p.sig)[0] : null;
      if (best && best.s >= 0.45) {
        const res = placeTpl(best.t, i);
        ids.push.apply(ids, res.ids);
        nOwn += res.nOwn;
        nTpl += res.ids.length - res.nOwn;
        tplNames.push(best.t.name);
        continue;
      }
      const r = partRange(i);
      let found = { own: [], cust: [] };
      try { found = await findFields(pdf, r[0], r[1]); } catch (e) { console.warn('Felder erkennen:', e); }
      if (pdf !== S.pdf || S.mode !== 'send') return;
      if (autoCust()) { const c = placeCustFields(found); ids.push.apply(ids, c); nCust += c.length; }
      if (S.mySig) found.own.forEach(f => { const o = placeOwnInField(f); if (o) { ids.push(o.id); nOwn++; } });
      else ownWait.push.apply(ownWait, found.own);
    }
    const msg = [intro];
    if (tplNames.length) msg.push((tplNames.length === 1 ? 'Vorlage ' : 'Vorlagen ') + tplNames.map(n => '„' + n + '“').join(' und ') + ': ' + nTpl + ' ' + plural(nTpl, 'Feld', 'Felder') + ' gesetzt.');
    if (nCust) msg.push(custMarked(nCust) + (nOwn ? ', dazu Ihre Unterschrift.' : '.'));
    else if (nOwn) msg.push('Ihre Unterschrift ist gesetzt.');
    if (ownWait.length) {
      msg.push('Hier unterschreiben Sie als Vermittler: ' + (ownWait.length === 1 ? '„' + ownWait[0].label + '“ auf Seite ' + (ownWait[0].page + 1) : ownWait.length + ' Stellen') +
        '. Speichern Sie Ihre Unterschrift einmal, dann setzt Firmio sie ab jetzt automatisch ein.');
      banner('info', msg.join(' '), { label: 'Jetzt speichern', fn: () => openMySigPad(() => {
        let n = 0;
        ownWait.forEach(f => { if (placeOwnInField(f)) n++; });
        renderBar();
        if (n) toast('Ihre Unterschrift ist gesetzt.');
      }) });
    } else {
      banner(ids.length ? 'ok' : 'info', msg.join(' ') + (ids.length ? ' Bitte kurz prüfen.' : ''),
        first > 0 ? { label: 'Wieder entfernen', fn: () => removeParts(first, S.parts.length - first) } : null);
    }
    renderBar();
  }

  /* ---------------- Eigene Unterschrift (Vermittler): einmal speichern, automatisch einsetzen ---------------- */
  const LS_MYSIG = 'firmio.meinesig.v1';
  function sigOk(o) {
    return !!o && typeof o.path === 'string' && o.path.length < 200000 && /^[MLQ0-9 .\-]+$/.test(o.path) &&
      [o.bw, o.bh, o.sw].every(v => typeof v === 'number' && isFinite(v) && v > 0 && v < 5000);
  }
  function loadMySig() { try { const o = JSON.parse(localStorage.getItem(LS_MYSIG)); return sigOk(o) ? o : null; } catch (e) { return null; } }
  function saveMySig(o) {
    try { if (o) localStorage.setItem(LS_MYSIG, JSON.stringify(o)); else localStorage.removeItem(LS_MYSIG); } catch (e) { return false; }
    S.mySig = o || null;
    return true;
  }
  // Seitenbereich von Teil i [von, bis) – bei einem einzelnen PDF alle Seiten
  function partRange(i) {
    if (!S.parts || S.parts.length < 2) return [0, S.pages.length];
    let from = 0;
    for (let k = 0; k < i; k++) from += S.parts[k].pages;
    return [from, from + S.parts[i].pages];
  }
  const inPart = (o, i) => { const r = partRange(i); return o.page >= r[0] && o.page < r[1]; };
  const spotListIn = i => { const r = partRange(i); return S.spots.filter(sp => sp.page >= r[0] && sp.page < r[1]).map(sp => spotRow(sp, r[0])); };
  const ownListIn = i => { const r = partRange(i); return S.own.filter(o => o.page >= r[0] && o.page < r[1]).map(o => [o.page + 1 - r[0], Math.round(o.x), Math.round(o.y), Math.round(o.w)]); };
  const tplSigIn = i => JSON.stringify([spotListIn(i), ownListIn(i)]);
  const tplSig = () => tplSigIn(0);
  const tplOfPart = i => i === 0 ? S.tpl : (S.parts[i] && S.parts[i].tpl) || null;

  // Unterschrift einmal zeichnen (Einstellungen oder direkt aus dem Dokument)
  function openMySigPad(then) {
    const pad = makePad(null);
    const err = el('p', { class: 'err', role: 'alert' });
    const ok = el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.check + '<span>Unterschrift speichern</span>' });
    ok.addEventListener('click', () => {
      if (!pad.valid()) { err.textContent = 'Bitte im weißen Feld unterschreiben.'; return; }
      const sig = Object.assign(sigFromStrokes(pad.strokes(), pad.width()), { created: Date.now() });
      if (!saveMySig(sig)) { err.textContent = 'Konnte auf diesem Gerät nicht gespeichert werden.'; return; }
      closeSheet();
      toast('Ihre Unterschrift ist gespeichert.');
      if (then) setTimeout(then, 320);
    });
    openSheet('Meine Unterschrift', el('div', null,
      el('p', { class: 'prose', text: 'Ihre Unterschrift als Vermittler. Firmio setzt sie automatisch dort ein, wo im Dokument „Unterschrift Vermittler“ steht (auch Berater, Vertreter, Makler). Sie wird nur auf diesem Gerät gespeichert.' }),
      el('div', { class: 'lblrow' }, el('span', { text: 'Ihre Unterschrift' }),
        el('button', { type: 'button', text: 'Löschen', onclick: () => { pad.clear(); err.textContent = ''; } })),
      pad.node, err, ok), { onClose: () => pad.destroy() });
    requestAnimationFrame(() => requestAnimationFrame(pad.resize));
  }

  // Eigene Unterschrift aufs Blatt legen (verschiebbar, Größe änderbar, löschbar)
  function placeOwn(pi, x, y, w, doSelect) {
    const pg = S.pages[pi];
    if (!pg || !S.mySig) return null;
    w = clamp(w, 50, Math.min(260, pg.W));
    const h = ownH(w);
    const it = { id: nid(), type: 'own', page: pi, w: w, x: clamp(x, 0, Math.max(0, pg.W - w)), y: clamp(y, 0, Math.max(0, pg.H - h)) };
    S.own.push(it);
    renderItem(it, true);
    if (doSelect) select(it);
    S.dirty = true;
    return it;
  }
  // In ein erkanntes Feld: auf die Linie, höchstens etwa 42 pt hoch
  function placeOwnInField(f) {
    let w = clamp(f.w, 70, 200), guard = 0;
    while (ownH(w) > 42 && w > 70 && guard++ < 60) w *= 0.95;
    return placeOwn(f.page, f.x, f.bottom - ownH(w), w, false);
  }
  function placeOwnHere() {
    if (!S.mySig) { openMySigPad(placeOwnHere); return; }
    const pg = S.pages[S.cur];
    if (!pg) return;
    const w = 150, it = placeOwn(S.cur, pg.W * 0.5, visibleCenterPt(pg) - ownH(w) / 2, w, true);
    if (it) { scrollToObj(it); toast('Ziehen Sie Ihre Unterschrift an die richtige Stelle.'); }
  }

  /* Erkennen, wo der Vermittler unterschreibt: Beschriftung im Text (pdf.js) und Strich darüber (Zeichenbefehle). */
  const OWN_RE = /unterschrift[^.:;!?]{0,28}?(vermittler|berater|vertreter|makler|agentur|aussendienst|betreuer|vertriebspartner)|(vermittler|berater|vertreter|makler|aussendienst|betreuer|vertriebspartner)[^.:;!?]{0,22}?unterschrift/;
  function labelSegments(items, vp) {
    const its = [];
    items.forEach(it => {
      const t = it.transform;
      if (!it.str || !it.str.trim() || !t || Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01 || t[0] <= 0) return;
      const fs = Math.abs(t[3]) || Math.abs(t[0]) || 10;
      const p0 = vp.convertToViewportPoint(t[4], t[5]), p1 = vp.convertToViewportPoint(t[4] + (it.width || 0), t[5]);
      its.push({ str: it.str, x0: Math.min(p0[0], p1[0]), x1: Math.max(p0[0], p1[0]), y: p0[1], fs: fs });
    });
    its.sort((a, b) => a.y - b.y || a.x0 - b.x0);
    const lines = [];
    its.forEach(it => {
      const ln = lines.find(l => Math.abs(l.y - it.y) < Math.max(1.5, it.fs * 0.35));
      if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
    });
    const segs = [];
    lines.forEach(ln => {
      ln.items.sort((a, b) => a.x0 - b.x0);
      let cur = null;
      ln.items.forEach(it => {
        const gap = cur ? it.x0 - cur.x1 : 0;
        if (!cur || gap > Math.max(12, it.fs * 1.6)) { cur = { text: it.str, x0: it.x0, x1: it.x1, y: it.y, fs: it.fs }; segs.push(cur); return; }
        cur.text += (gap > it.fs * 0.2 && !/\s$/.test(cur.text) ? ' ' : '') + it.str;
        cur.x1 = Math.max(cur.x1, it.x1);
        cur.fs = Math.max(cur.fs, it.fs);
      });
    });
    return segs;
  }
  // Waagerechte Striche (Linien und sehr flache Rechtecke) in Seitenkoordinaten wie die Anzeige
  async function hLines(page, vp) {
    const O = pdfjsLib.OPS || {};
    let ol;
    try { ol = await page.getOperatorList(); } catch (e) { return []; }
    const out = [], stack = [];
    let m = [1, 0, 0, 1, 0, 0];
    const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    const pt = (x, y) => vp.convertToViewportPoint(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    const seg = (a, b, tol) => { if (Math.abs(a[1] - b[1]) <= tol && Math.abs(a[0] - b[0]) > 40) out.push({ x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y: (a[1] + b[1]) / 2 }); };
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], args = ol.argsArray[i];
      if (fn === O.save) stack.push(m);
      else if (fn === O.restore || fn === O.paintFormXObjectEnd) { if (stack.length) m = stack.pop(); }
      else if (fn === O.paintFormXObjectBegin) { stack.push(m); if (args && Array.isArray(args[0]) && args[0].length === 6) m = mul(m, args[0]); }
      else if (fn === O.transform && args && args.length === 6) m = mul(m, args);
      else if (fn === O.constructPath && args && args[0] && args[1]) {
        const ops = args[0], c = args[1];
        let j = 0, cur = null;
        for (let k = 0; k < ops.length; k++) {
          const op = ops[k];
          if (op === O.moveTo) { cur = pt(c[j], c[j + 1]); j += 2; }
          else if (op === O.lineTo) { const q = pt(c[j], c[j + 1]); j += 2; if (cur) seg(cur, q, 1.2); cur = q; }
          else if (op === O.rectangle) { const a = pt(c[j], c[j + 1]), b = pt(c[j] + c[j + 2], c[j + 1] + c[j + 3]); j += 4; seg(a, b, 2.5); }
          else if (op === O.curveTo) j += 6;
          else if (op === O.curveTo2 || op === O.curveTo3) j += 4;
        }
      }
    }
    return out;
  }
  // Feld zur Beschriftung finden: Strich darüber, Strich rechts daneben oder Unterstriche.
  // fallback: ohne Strich direkt über die Beschriftung (nur für die eigene Unterschrift)
  function fieldFor(lb, lines, fallback) {
    const top = lb.y - lb.fs * 0.85;
    let best = null;
    lines.forEach(l => { // Strich über der Beschriftung (häufigste Form)
      const dy = top - l.y;
      if (dy < -1.5 || dy > Math.max(26, lb.fs * 3.2) || l.x1 < lb.x0 - 4 || l.x0 > lb.x1 + 40) return;
      if (!best || dy < best.dy) best = { l: l, dy: dy };
    });
    if (best) return { x: best.l.x0 + 3, w: best.l.x1 - best.l.x0 - 6, bottom: best.l.y - 1 };
    let right = null;
    lines.forEach(l => { // „Unterschrift: ____“ mit Strich rechts daneben
      if (Math.abs(l.y - lb.y) <= lb.fs * 0.7 + 2 && l.x0 >= lb.x1 - 8 && l.x0 - lb.x1 < 40 && (!right || l.x0 < right.x0)) right = l;
    });
    if (right) return { x: right.x0 + 3, w: right.x1 - right.x0 - 6, bottom: right.y - 1 };
    const us = lb.text.indexOf('___');
    if (us > 0) { const xu = lb.x0 + (lb.x1 - lb.x0) * us / lb.text.length; return { x: xu + 2, w: lb.x1 - xu - 4, bottom: lb.y - 1 }; }
    return fallback ? { x: lb.x0, w: clamp((lb.x1 - lb.x0) * 1.3, 110, 200), bottom: top - 2 } : null;
  }
  // Beschriftung einordnen: eigene Unterschrift (Vermittler), Unterschrift des Kunden, Ort/Datum
  const CUST_RE = /\bunterschrift\b|\bunterzeichnung\b/;
  const DATE_RE = /^\W*(ort\W{0,3}(und\W+|\/\W*|,\W*)?datum|datum\W{0,3}(und\W+|\/\W*|,\W*)?ort|datum)\b/;
  function classify(text, fs) {
    const t = fold(text).replace(/[_.\s]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 70 || fs > 14 || /unterschriften/.test(t)) return ''; // Fließtext, Überschriften
    if (OWN_RE.test(t) && !/gesetzlich\w*\s+vertreter/.test(t)) return 'own';
    if (CUST_RE.test(t.replace(/(datum|tag) der unterschrift/g, ''))) return 'cust';
    if (DATE_RE.test(t)) return 'date';
    return '';
  }
  // Seiten from … to (ohne to) durchsuchen, höchstens 40
  async function findFields(pdf, from, to) {
    const res = { own: [], cust: [] };
    from = from || 0;
    to = Math.min(to || pdf.numPages, pdf.numPages, from + 40);
    for (let i = from; i < to; i++) {
      if (pdf !== S.pdf) return { own: [], cust: [] };
      let page, tc;
      try { page = await pdf.getPage(i + 1); tc = await page.getTextContent(); } catch (e) { continue; }
      const vp = page.getViewport({ scale: 1 });
      if (vp.rotation % 360 !== 0) continue;
      const labels = labelSegments(tc.items, vp).map(sg => Object.assign(sg, { kind: classify(sg.text, sg.fs) })).filter(sg => sg.kind);
      if (!labels.length) continue;
      const lines = await hLines(page, vp);
      const taken = [];
      labels.forEach(lb => {
        const f = fieldFor(lb, lines, lb.kind === 'own');
        if (!f || f.w <= 30) return;
        if (taken.some(x => Math.abs(x.x - f.x) < 10 && Math.abs(x.bottom - f.bottom) < 10)) return;
        taken.push(f);
        // Ort/Datum setzt der Absender selbst: die Linie wird nur belegt, damit dort keine Unterschrift landet
        if (lb.kind !== 'date') res[lb.kind].push(Object.assign({ page: i, label: lb.text.replace(/[_\s]+$/, '').trim() }, f));
      });
    }
    return res;
  }

  /* ---------------- Kundenname aus dem PDF vorschlagen (läuft nur auf dem Gerät, nichts wird hochgeladen) ---------------- */
  // Wörter, die kein Name sind (klein und ohne Umlaute wie von fold())
  const NAME_STOP = new Set(('herr herrn frau familie fam eheleute firma name vorname vornamen nachname familienname zuname geburtsname geburtsdatum geboren datum ort plz ' +
    'strasse str weg platz allee ring gasse hausnummer telefon tel mobil handy email mail fax versicherung versicherungen versicherungsnehmer ' +
    'versicherungsnehmerin antragsteller antragstellerin kunde kundin vermittler vermittlerin berater beraterin unterschrift antrag vertrag ' +
    'police tarif beitrag axa ag gmbh kg ohg mbh se ug eg ev gbr co bank sparkasse volksbank iban bic konto kontoinhaber kontoinhaberin seite nummer nr ' +
    'deutschland anschrift adresse und oder mit bitte angaben person personen daten wie siehe oben gleich identisch keine kein ja nein vn vp ' +
    'beitragszahler hauptvertretung generalvertretung agentur service team gesellschaft verein stiftung').split(' '));
  const NAME_TITLE = /^(herrn?|frau|hr\.?|fr\.?|dr\.?|prof\.?|dipl\.?-?[a-zäöü.]*|mag\.?|ing\.?|med\.?|rer\.?|nat\.?)$/i;
  const NAME_PART = /^(von|van|de|da|di|del|della|der|den|du|zu|ten|ter|la|le|al|el|bin|ibn|y)$/;
  const NAME_FAKE = /^(muster|beispiel)/; // Platzhalter in Mustern: Max Mustermann, Erika Musterfrau
  // Bereiche und Beschriftungen, die NICHT der Kunde sind (Vermittler, versicherte Kinder, Arzt …); Text wie von fold() (ä → a)
  const NOT_CUST = /vermittler|berater|betreuer|agentur|vertreter|vertretung|ansprechpartner|makler|aussendienst|geschaftsstelle|absender|versicherer|versicherte\w* person|mitversichert|bezugsberecht|begunstigt|\bkind(er)?\b|ehepartner|lebenspartner|arzt|bevollmachtigt/;
  const FIELD_NOT = /(^|[^a-z])(vp|vm|kind|ehe|bank|arzt|bezug|beg)/; // Namen von Formularfeldern, z. B. „VP_Name“
  const CUST_HEAD = /^(versicherungsnehmer(in)?|antragsteller(in)?|kunde|kundin|ihre (personlichen )?daten|personliche (daten|angaben)|angaben zu(m|r) (versicherungsnehmer\w*|antragsteller\w*|person))\b/;
  const NUM_HEAD = /^(?:\d+(?:\.\d+)*[.)]?|[a-h][.)]|[ivx]+\.)\s+(?=\p{L})/iu; // „1. “, „2.3 “, „B) “, „IV. “
  const STREET_LINE = /^\p{L}[\p{L}.'’ -]*\s\d+\s?[a-z]?(\s*[-/]\s*\d+\s?[a-z]?)?$/iu;
  const PLZ_LINE = /^(?:D-?\s?)?\d{5}\s+\p{L}/u;
  // Gleiche Person? Alle Wörter des einen Namens kommen im anderen vor (Reihenfolge egal)
  const nameIn = (k, hay) => { const h = ' ' + hay + ' '; return k.split(' ').every(x => h.indexOf(' ' + x + ' ') >= 0); };
  // Prüft einen Namen und schreibt ihn ordentlich: „Herr ARBEN HOXHA“ → „Arben Hoxha“, „Hoxha, Arben“ → „Arben Hoxha“
  function personNameOf(raw, reverse) {
    let c = String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').split(',').map(x => x.trim()).filter(Boolean);
    // „Name, Straße 1, PLZ Ort“ oder „Name, geb. …“: nur der Name vorne
    const cut = c.findIndex((x, k) => k > 0 && (/\d|\bgeb\.|geboren/i.test(x) || /(str\.|stra(ss|ß)e|weg|platz|allee|gasse|ring)$/i.test(x)));
    if (cut > 0) c = c.slice(0, cut);
    c = c.map(x => x.replace(/\s(?:geb\.|geboren\b|kd\.|kunden-?nr|nr\.|\d).*$/i, '').replace(/^[\s:–-]+|[\s;:–-]+$/g, '').trim()).filter(Boolean);
    if (!c.length || c.length > 2) return '';
    const real = x => x.split(' ').filter(y => y && !NAME_TITLE.test(y) && !NAME_PART.test(y.toLowerCase())).length;
    // „Hoxha, Arben“ umdrehen; bei „Arben Hoxha, Remscheid“ nur den Namen
    const s = c.length === 2 ? (real(c[0]) === 1 ? c[1] + ' ' + c[0] : c[0]) : c[0];
    if (s.length > 60 || /[\d@/\\[\]{}<>=+*#%&§$€|]/.test(s)) return '';
    let w = s.split(' ').filter(x => !NAME_TITLE.test(x));
    if (c.length < 2 && reverse && w.length === 2) w = [w[1], w[0]];
    if (w.length < 2 || w.length > 5) return '';
    let n = 0;
    for (const x of w) {
      if (NAME_PART.test(x.toLowerCase())) continue;
      const f = fold(x).replace(/[^a-z]/g, '');
      if (!/^\p{Lu}[\p{L}'’-]*\.?$/u.test(x) || NAME_STOP.has(f) || NAME_FAKE.test(f)) return '';
      n++;
    }
    if (n < 2) return '';
    return w.map(x => NAME_PART.test(x.toLowerCase()) ? x.toLowerCase()
      : x.length > 2 && x === x.toUpperCase() ? x.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : x).join(' ');
  }
  // Ein einzelnes Namenswort (getrennte Felder „Name“ und „Vorname“): „HOXHA“ → „Hoxha“
  function nameWordOf(raw) {
    const s = String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/[\s;:]+$/g, '').trim();
    if (!s || s.length > 40 || /[\d@,]/.test(s)) return '';
    const n = personNameOf(s + ' Xx');
    return n ? n.slice(0, -3) : '';
  }
  // Beschriftungen (Text ohne Doppelpunkte, Groß/klein egal); die letzte Gruppe ist ein Wert in derselben Zeile
  const L_CUST = /^(versicherungsnehmer(?:in)?|vers\.?-? ?nehmer(?:in)?|vn|antragsteller(?:in)?|kunde|kundin|kundenname|name des (?:versicherungsnehmers|antragstellers|kunden)|name der (?:versicherungsnehmerin|antragstellerin|kundin))\b ?(.*)$/i;
  const L_REV = /^((?:nach|familien|zu)?name(?:,| \/| und)? vorname)\b ?(.*)$/i;
  const L_FWD = /^(vorname(?:,| \/| und)? (?:nach|familien|zu)?name|vor- ?und (?:nach|familien|zu)name)\b ?(.*)$/i;
  const L_ONE = /^((?:nach|familien|zu)?name|vorname)\b ?(.*)$/i;
  const L_KTO = /^(kontoinhaber(?:in)?|name des kontoinhabers)\b ?(.*)$/i;
  const L_SIGN = /^unterschrift (?:des |der )?(?:versicherungsnehmer|antragsteller|kunde|kundin)\w*$/i; // gedruckter Name darunter
  const L_OF = /\s(?:des|der) (?:versicherungsnehmer(?:s|in)|antragsteller(?:s|in)|kunden|kundin)\b/i; // „Name, Vorname des Antragstellers“
  const SALUT = /^(?:sehr geehrte[rs]?|liebe[rs]?|hallo|guten tag),? (?:herr|frau) (?:(?:dr|prof)\.? )*([a-z][a-z-]+)/;
  // Die ersten Seiten jedes PDFs durchsuchen (ranges: [[von, bis], …]): Anschriftfeld, „Versicherungsnehmer“, „Name, Vorname“,
  // getrennte Felder, ausgefüllte Formularfelder. Ergebnis: { name, score } oder null.
  // Der eigene Name, der eigene Zusatz (z. B. „Hauptvertretung Jörg Liedtke“) und Vermittler-Angaben werden übergangen.
  async function guessCustomer(pdf, ranges) {
    const pages = [];
    ranges.forEach(r => { for (let i = r[0]; i < Math.min(r[1], r[0] + 6, pdf.numPages); i++) if (pages.length < 16) pages.push({ i: i, top: i === r[0] }); });
    const cfg = loadSender(), me = fold(cfg.name || '').replace(/\s+/g, ' ').trim(), org = fold(cfg.sub || '').replace(/[^a-z0-9-]+/g, ' ').trim();
    const cand = new Map(), lastNames = [];
    let order = 0;
    const add = (name, score) => {
      if (!name || score <= 0) return;
      const k = fold(name);
      if (me && (k === me || (me.indexOf(' ') > 0 && (nameIn(k, me) || nameIn(me, k))))) return; // der eigene Name
      if (org && nameIn(k, org)) return;
      const c = cand.get(k) || { name: name, score: 0, at: order++ };
      c.score += score;
      cand.set(k, c);
    };
    for (const pg of pages) {
      if (pdf !== S.pdf) return null;
      let page, tc, ann = [];
      try { page = await pdf.getPage(pg.i + 1); tc = await page.getTextContent(); } catch (e) { continue; }
      try { ann = await page.getAnnotations(); } catch (e) { ann = []; }
      const vp = page.getViewport({ scale: 1 });
      if (vp.rotation % 360 !== 0) continue;
      const segs = labelSegments(tc.items, vp);
      // ausgefüllte Formularfelder wie Text behandeln (Wert an der Stelle des Feldes)
      ann.forEach(a => {
        if (!a || a.subtype !== 'Widget' || a.fieldType !== 'Tx' || typeof a.fieldValue !== 'string' || !a.fieldValue.trim() || !Array.isArray(a.rect)) return;
        const r = vp.convertToViewportRectangle(a.rect);
        const y0 = Math.min(r[1], r[3]), y1 = Math.max(r[1], r[3]);
        segs.push({ text: a.fieldValue.replace(/\s+/g, ' ').trim(), x0: Math.min(r[0], r[2]), x1: Math.max(r[0], r[2]), y: y1 - 2, fs: clamp((y1 - y0) * 0.7, 6, 14), field: fold(a.fieldName || '') || ' ' });
      });
      segs.sort((a, b) => a.y - b.y || a.x0 - b.x0);
      // Nachbar: in derselben Zeile rechts, darunter oder darüber (gleiche Spalte)
      const near = (s, dir) => {
        let best = null, bd = 1e9;
        segs.forEach(o => {
          if (o === s) return;
          let d;
          if (dir === 'right') {
            if (Math.abs(o.y - s.y) > Math.max(2.5, s.fs * 0.6) || o.x0 < s.x1 - 2 || o.x0 - s.x1 > 260) return;
            d = o.x0 - s.x1;
          } else if (dir === 'below') {
            d = o.y - s.y;
            if (d <= 1 || d > Math.max(9, s.fs) * 2.6 || o.x0 < s.x0 - 14 || o.x0 > s.x0 + Math.max(40, (s.x1 - s.x0) * 0.5)) return;
          } else {
            d = s.y - o.y;
            if (d <= 1 || d > Math.max(9, s.fs) * 2.6 || Math.abs(o.x0 - s.x0) > 14) return;
          }
          if (d < bd) { bd = d; best = o; }
        });
        return best;
      };
      // Mögliche Werte zu einer Beschriftung: Rest derselben Zeile, sonst rechts daneben, sonst darunter (Formular-Stil)
      const valuesOf = (s, rest) => {
        if (rest && rest.trim()) return [{ text: rest, how: 'same' }];
        const r = near(s, 'right'), b = near(s, 'below');
        return [r && { text: r.text, how: 'right' }, b && { text: b.text, how: 'below' }].filter(Boolean);
      };
      const pick = (vals, parse) => { for (const v of vals) { const n = parse(v.text); if (n) return { name: n, how: v.how }; } return null; };
      // Abschnitte: Überschrift mit ihrer Spalte (bis zum nächsten Text rechts daneben); die nächste darüber gilt
      const heads = [];
      const headAt = (kind, s) => {
        let xb = Infinity;
        segs.forEach(o => { if (o !== s && Math.abs(o.y - s.y) < 3 && o.x0 > s.x1 && o.x0 - 5 < xb) xb = o.x0 - 5; });
        heads.push({ kind: kind, y: s.y, xa: s.x0 - 20, xb: xb });
      };
      const ctxOf = s => {
        let h = null;
        heads.forEach(x => { if (x.y < s.y - 1 && s.y - x.y <= 320 && s.x0 >= x.xa && s.x0 < x.xb && (!h || x.y > h.y)) h = x; });
        return h ? h.kind : '';
      };
      let first = null, last = null;
      const pair = bonus => {
        if (!first || !last || Math.abs(first.y - last.y) >= 90) return;
        add(personNameOf(first.v + ' ' + last.v), 3 + bonus);
        first = last = null;
      };
      const top = []; // links oben auf der ersten Seite: vielleicht ein Anschriftfeld ohne „Herrn“/„Frau“
      segs.forEach(s => {
        const raw = s.text.replace(/\s+/g, ' ').trim();
        let ln = raw.replace(/\([^)]*\)/g, ' ').replace(/\/-?in\b|\*in\b/gi, '').replace(/[:*]+/g, ' ')
          .replace(/\s*\/\s*/g, ' / ').replace(/\s*,\s*/g, ', ')
          .replace(/ \/ (?:beitragszahler|antragsteller|versicherungsnehmer|kontoinhaber|kunde|kundin|zahler)(?:in)?\b/gi, '')
          .replace(/(?:,| \/| bzw\.?| oder| und) (?:firma|firmenname|firmierung|titel|akad(?:\.|emischer) grad)\b/gi, '')
          .replace(/\s+/g, ' ').trim().replace(NUM_HEAD, '');
        const t = fold(ln);
        if (!t) return;
        let m = SALUT.exec(t);
        if (m) { lastNames.push(m[1]); return; }
        // Überschrift (kurz, ohne Wert dahinter): Kunde, jemand anderes oder ein anderer nummerierter Abschnitt
        if (!s.field && t.length <= 45 && !/\d/.test(t) && !/:\s*\S/.test(raw)) {
          if (NOT_CUST.test(t) && !/^(name|vorname)\b/.test(t)) headAt('other', s);
          else if (CUST_HEAD.test(t)) headAt('cust', s);
          else if (NUM_HEAD.test(raw)) headAt('', s);
        }
        const ctx = ctxOf(s);
        if (ctx === 'other' || NOT_CUST.test(t) || (s.field && (NOT_CUST.test(s.field) || FIELD_NOT.test(s.field)))) return;
        let bonus = ctx === 'cust' ? 1 : 0;
        if (s.field) { // Formularfeld mit sprechendem Namen (z. B. „VN_Vorname“), auch ohne Beschriftung daneben
          if (/vorname|first/.test(s.field)) { const v = nameWordOf(s.text); if (v) first = { v: v, y: s.y }; }
          else if (/name|surname|last/.test(s.field)) {
            const full = personNameOf(s.text);
            if (full) add(full, 3 + bonus);
            else { const v = nameWordOf(s.text); if (v) last = { v: v, y: s.y }; }
          } else return;
          pair(bonus);
          return;
        }
        // Anschriftfeld links oben auf der ersten Seite: „Herrn“ / „Frau“, darunter der Name (oder in derselben Zeile)
        if (pg.top && s.y < vp.height * 0.5 && s.x0 < vp.width * 0.45) {
          if (/^(herrn?|frau|familie|eheleute)$/.test(t)) { const b = near(s, 'below'); if (b) add(personNameOf(b.text), 4); return; }
          if (/^(herrn?|frau) \S+ \S+/.test(t)) { add(personNameOf(ln), 3); return; }
          top.push(s);
        }
        if ((m = L_CUST.exec(ln))) { const v = pick(valuesOf(s, m[2]), x => personNameOf(x)); if (v) add(v.name, (v.how === 'below' ? 4 : 5) + bonus); return; }
        if ((m = L_KTO.exec(ln))) { const v = pick(valuesOf(s, m[2]), x => personNameOf(x)); if (v) add(v.name, 2); return; }
        if (L_SIGN.test(ln)) { const b = near(s, 'below'); if (b) add(personNameOf(b.text), 3); return; }
        if (L_OF.test(ln)) { ln = ln.replace(L_OF, ''); bonus = 1; } // „… des Versicherungsnehmers“ zählt wie der Abschnitt
        if ((m = L_REV.exec(ln))) { const v = pick(valuesOf(s, m[2]), x => personNameOf(x, true)); if (v) add(v.name, 4 + bonus); return; }
        if ((m = L_FWD.exec(ln))) { const v = pick(valuesOf(s, m[2]), x => personNameOf(x)); if (v) add(v.name, 4 + bonus); return; }
        if ((m = L_ONE.exec(ln)) && ln.length <= 40) {
          const vals = valuesOf(s, m[2]);
          if (/^vorname$/i.test(m[1])) { const v = pick(vals, nameWordOf); if (v) first = { v: v.name, y: s.y }; }
          else {
            const full = pick(vals, x => personNameOf(x));
            if (full) add(full.name, 3 + bonus);
            else { const v = pick(vals, nameWordOf); if (v) last = { v: v.name, y: s.y }; }
          }
          pair(bonus);
        }
      });
      // Anschriftfeld ohne Anrede: Name, darunter Straße mit Hausnummer, darunter PLZ und Ort
      top.forEach(s => {
        const st = near(s, 'below'), pz = st && STREET_LINE.test(st.text.trim()) ? near(st, 'below') : null;
        if (!pz || !PLZ_LINE.test(pz.text.trim())) return;
        const up = near(s, 'above');
        if (up && NOT_CUST.test(fold(up.text))) return;
        add(personNameOf(s.text), 3);
      });
    }
    // Anrede „Sehr geehrter Herr Hoxha“ bestätigt den Nachnamen
    cand.forEach(c => { const w = fold(c.name).split(' '); if (lastNames.indexOf(w[w.length - 1]) >= 0) c.score += 2; });
    const best = [...cand.values()].sort((a, b) => b.score - a.score || a.at - b.at)[0];
    return best && best.score >= 3 ? { name: best.name, score: best.score } : null;
  }
  // Im Hintergrund nach dem Öffnen, Anhängen oder Entfernen (Absender); „Weiter“ wartet kurz darauf
  function guessCustomerLater() {
    const pdf = S.pdf;
    if (S.mode !== 'send' || S.view || !pdf || S.custGuess) return;
    const ranges = S.parts.length > 1 ? S.parts.map((p, i) => partRange(i)) : [[0, S.pages.length]];
    const p = guessCustomer(pdf, ranges).then(g => { if (g && pdf === S.pdf && !S.custGuess) S.custGuess = g; }).catch(e => console.warn('Kundenname:', e));
    S.custGuessP = p;
    p.then(() => { if (S.custGuessP === p) S.custGuessP = null; });
  }

  // Unterschriftsfelder des Kunden setzen – auf die erkannte Linie (Ort/Datum nicht, das setzt der Absender selbst)
  const LS_AUTO = 'firmio.auto.v1';
  const autoCust = () => getLS(LS_AUTO) !== '0';
  function placeCustFields(found) {
    const ids = [];
    found.cust.forEach(f => {
      const pg = S.pages[f.page];
      if (!pg) return;
      const w = clamp(f.w, 100, 230), h = 40;
      const sp = { id: nid(), type: 'spot', k: 's', page: f.page, w: w, h: h, x: clamp(f.x, 0, pg.W - w), y: clamp(f.bottom - h, 0, pg.H - h) };
      S.spots.push(sp);
      renderSpot(sp);
      ids.push(sp.id);
    });
    if (ids.length) S.dirty = true;
    return ids;
  }
  const custMarked = n => 'Automatisch markiert: ' + n + ' ' + plural(n, 'Unterschriftsfeld', 'Unterschriftsfelder') + ' für Ihren Kunden';

  // Nach dem Öffnen im Absender-Modus: Vorlage prüfen, sonst Felder des Kunden und eigene Unterschrift erkennen
  async function afterOpenSend() {
    guessCustomerLater(); // Kundenname aus dem PDF vorschlagen (im Hintergrund)
    if (S.parts.length > 1) { // mehrere PDFs auf einmal gewählt: je PDF Vorlage oder Erkennung
      S.docSig = S.parts[0].sig;
      await prepParts(0, S.parts.length + ' PDFs zusammengefügt (' + S.pages.length + ' Seiten).');
      return;
    }
    const pdf = S.pdf;
    const t = await checkTemplates().catch(e => { console.warn('Vorlagen:', e); return null; });
    const stale = () => pdf !== S.pdf || S.mode !== 'send' || S.view;
    if (stale()) return;
    const needOwn = !(t && S.own.length); // Vorlage hat die eigene Unterschrift schon gesetzt
    const needCust = !t && autoCust() && !S.spots.length;
    if (!needOwn && !needCust) return;
    let found = { own: [], cust: [] };
    try { found = await findFields(pdf); } catch (e) { console.warn('Felder erkennen:', e); }
    if (stale() || S.sheetOpen) return;
    const custIds = needCust && !S.spots.length && !S.own.length ? placeCustFields(found) : [];
    const own = needOwn && !S.own.length ? found.own : [];
    if (own.length && !S.mySig) {
      const where = own.length === 1 ? '„' + own[0].label + '“ auf Seite ' + (own[0].page + 1) : own.length + ' Stellen';
      if (!S.tpl) banner(custIds.length ? 'ok' : 'info', (custIds.length ? custMarked(custIds.length) + '. ' : '') + 'Hier unterschreiben Sie als Vermittler: ' + where + '. Speichern Sie Ihre Unterschrift einmal, dann setzt Firmio sie ab jetzt automatisch ein.',
        { label: 'Jetzt speichern', fn: () => openMySigPad(() => autoOwn(own, t, custIds)) });
      renderBar();
      return;
    }
    if (own.length || custIds.length) autoOwn(own, t, custIds);
  }
  function autoOwn(fields, t, custIds) {
    if (S.mode !== 'send') return;
    custIds = (custIds || []).filter(id => S.spots.some(sp => sp.id === id));
    const ids = S.mySig ? fields.map(placeOwnInField).filter(Boolean).map(o => o.id) : [];
    if (!ids.length && !custIds.length) return;
    S.ownAuto = ids;
    if (S.tpl) { S.tpl.ids = S.tpl.ids.concat(ids); S.tpl.sig = tplSig(); }
    const parts = [];
    if (t && S.tpl) parts.push('Vorlage „' + S.tpl.name + '“: ' + S.spots.length + ' ' + plural(S.spots.length, 'Feld', 'Felder') + ' gesetzt.');
    if (custIds.length) parts.push(custMarked(custIds.length) + (ids.length ? ', dazu Ihre Unterschrift.' : '.'));
    else if (ids.length) parts.push('Ihre Unterschrift ist gesetzt' + (fields.length === 1 ? ' (' + fields[0].label + ', Seite ' + (fields[0].page + 1) + ')' : ' (' + ids.length + ' Stellen)') + '.');
    banner('ok', parts.join(' ') + ' Bitte kurz prüfen.', { label: 'Rückgängig', fn: () => {
      if (S.tpl && t) { undoTpl(); return; }
      S.own.filter(o => ids.indexOf(o.id) >= 0).forEach(o => removeObj(o));
      S.spots.filter(sp => custIds.indexOf(sp.id) >= 0).forEach(sp => removeObj(sp));
      banner('info', custIds.length ? 'Entfernt. Setzen Sie die Felder unten mit „Unterschrift“ und „Ort/Datum“ selbst.' : 'Entfernt. Mit dem Stift oben setzen Sie Ihre Unterschrift selbst.');
    } });
    renderBar();
  }

  // Vor dem Senden: eigene Unterschrift fest ins PDF schreiben (dann sieht der Kunde sie, und sie ist im fertigen PDF)
  async function burnOwn() {
    if (!S.own.length || !S.mySig) return false;
    busy('Ihre Unterschrift wird eingesetzt …');
    try {
      if (!S.docSig && S.parts.length < 2) { try { S.docSig = S.parts[0].sig = await docSig(S.pdf); } catch (e) { /* egal */ } } // Vorlagen erkennen später das Original
      const L = await loadPdfLib();
      let doc, raster = false;
      try {
        doc = await L.PDFDocument.load(S.file.bytes, { updateMetadata: false });
        if (doc.isEncrypted || doc.getPageCount() !== S.pages.length) throw new Error('raster');
      } catch (e) { doc = await rasterize(L); raster = true; busy('Ihre Unterschrift wird eingesetzt …'); }
      const font = await doc.embedFont(L.StandardFonts.Helvetica);
      const cs = new Set(font.getCharacterSet());
      const ink = L.rgb(INK[0] / 255, INK[1] / 255, INK[2] / 255), capColor = L.rgb(CAP[0] / 255, CAP[1] / 255, CAP[2] / 255);
      const capText = toWinAnsi(ownCaption(new Date()), cs), sig = S.mySig, pages = doc.getPages();
      S.own.forEach(it => {
        const pg = S.pages[it.page], page = pages[it.page];
        if (!pg || !page) return;
        const M = raster ? [1, 0, 0, 1, 0, 0] : virtualToUser(pg), c = ownCapSize(it.w);
        page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(M[0], M[1], M[2], M[3], M[4], M[5]), L.setLineJoin(L.LineJoinStyle.Round));
        page.drawSvgPath(sig.path, { x: it.x, y: pg.H - (it.y + c * 1.6), scale: it.w / sig.bw, borderColor: ink, borderWidth: sig.sw, borderLineCap: L.LineCapStyle.Round });
        page.drawText(capText, { x: it.x, y: pg.H - (it.y + c * 1.1), size: c, font: font, color: capColor });
        page.pushOperators(L.popGraphicsState());
      });
      const bytes = await doc.save({ useObjectStreams: false });
      const fresh = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      const old = S.pdf;
      S.file = { name: S.file.name, bytes: bytes, hash: await sha256(bytes) };
      S.pdf = fresh;
      try { old.destroy(); } catch (e) { /* egal */ }
      S.own.forEach(o => { if (o.node) o.node.remove(); });
      S.ownBurned = S.own.length;
      S.own = [];
      S.sel = null;
      await buildPages();
      S.spots.forEach(renderSpot);
      unbusy();
      return true;
    } catch (e) {
      console.error('Eigene Unterschrift:', e);
      unbusy();
      throw e;
    }
  }

  /* ---------------- Vor Ort: Kunde unterschreibt auf diesem Handy ---------------- */
  function startLocal(o) {
    const req = parseReqObj(o.info);
    if (!req) return;
    closeSheet(true);
    S.spots.forEach(sp => { if (sp.node) sp.node.remove(); });
    S.items.forEach(it => { if (it.node) it.node.remove(); });
    S.spots = []; S.items = []; S.sel = null; S.sig = null; S.out = null;
    S.name = ''; S.ort = ''; padMem = null; // nichts vom vorigen Kunden übernehmen
    S.sig2 = null; S.name2 = ''; padMem2 = null;
    S.local = { label: o.label, label2: o.label2 || '', note: o.note, saved: '', tpl: S.tpl ? S.tpl.id : '', parts: S.parts.length, lang: req.l, du: req.u === 1 };
    S.mode = 'sign';
    S.req = req;
    S.lang = req.l === 'sq' ? 'sq' : 'de';
    S.du = req.u === 1;
    S.fileIsRemote = false;
    applyStatic();
    $('#modeChip').textContent = tr('Vor Ort');
    $('#docName').textContent = signTitle();
    $('#ownBtn').classList.add('hidden');
    applyRequest();
    decoratePages(); // Überschriften der Teile wie beim Kunden, kein „Weiteres PDF anhängen“
    renderBar();
    S.dirty = false;
    window.scrollTo(0, 0);
    if (S.spots.length) setTimeout(() => scrollToObj(S.spots[0]), 150);
    toast('Jetzt das Handy an Ihren Kunden geben.', 3500);
  }
  // Nach der Vor-Ort-Unterschrift wieder in den Absender-Modus
  function endLocal() {
    if (!S.local) return;
    S.local = null;
    S.mode = 'send';
    S.req = null;
    S.lang = 'de';
    S.du = false;
    S.name = ''; S.ort = ''; padMem = null;
    S.sig2 = null; S.name2 = ''; padMem2 = null;
    applyStatic();
    setupStart();
  }
  async function saveLocal() {
    const L = S.local, now = Date.now();
    const id = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
    try {
      await Store.putPdf(id, S.out.bytes);
      const rec = { id: id, key: '', del: '', secret: '', label: L.label, label2: L.label2 || '', note: L.note, file: S.file.name, title: signTitle(), parts: L.parts || 1, pages: S.pages.length, created: now, expires: 0,
        lang: L.lang, du: L.du, status: 'signed', link: '', local: true, inPerson: true, seen: true, serverGone: true,
        signedAt: now, signer: S.name, signer2: S.sig2 ? S.name2 : '', ort: S.ort, outName: S.out.name, outPages: S.out.pages, size: S.out.bytes.length, tpl: L.tpl, mailPending: mailEnabled() };
      await Store.put(rec);
      L.saved = id;
      S.dirty = false;
      askPersist();
      if (rec.mailPending) mailFromPhone(rec, S.out.bytes); // läuft im Hintergrund, ohne Internet später
    } catch (e) {
      console.warn('Vor Ort speichern:', e);
      L.saved = '';
    }
    unbusy();
    showDone();
  }

  /* ---------------- Neue Version: installierte App lädt sich beim Öffnen selbst neu ---------------- */
  const RUN_VER = document.documentElement.getAttribute('data-version') || 'dev';
  let verCheck = 0, updateReady = false, picking = 0;
  async function checkUpdate() {
    if (RUN_VER === 'dev' || updateReady || Date.now() - verCheck < 60000) return;
    verCheck = Date.now();
    let v = '';
    try {
      const r = await fetch('version.txt', { cache: 'no-store', credentials: 'omit' });
      if (r.ok) v = (await r.text()).trim();
    } catch (e) { return; }
    if (!/^[A-Za-z0-9]{3,12}$/.test(v) || v === RUN_VER) return;
    let tried = '';
    try { tried = sessionStorage.getItem('firmio.reloadFor') || ''; } catch (e) { /* egal */ }
    if (tried === v) return; // schon einmal versucht (z. B. ohne Netz) – nicht ständig neu laden
    updateReady = v;
    reloadIfIdle();
  }
  // Nur neu laden, wenn gerade nichts angefangen ist (Startseite, kein Fenster offen)
  function reloadIfIdle() {
    if (!updateReady || S.inViewer || S.sheetOpen || !$('#busy').hidden || document.visibilityState !== 'visible') return;
    if (picking && Date.now() - picking < 120000) return;
    try { sessionStorage.setItem('firmio.reloadFor', updateReady); } catch (e) { /* egal */ }
    location.reload();
  }

  /* ---------------- Absender: Übersicht (liegt nur auf diesem Gerät) ---------------- */
  let idbP = null;
  function idb() {
    if (!idbP) {
      idbP = new Promise((res, rej) => {
        if (!window.indexedDB) { rej(new Error('noidb')); return; }
        let r;
        try { r = indexedDB.open('firmio', 1); } catch (e) { rej(e); return; }
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('req')) db.createObjectStore('req', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('pdf')) db.createObjectStore('pdf', { keyPath: 'id' });
        };
        r.onsuccess = () => {
          const db = r.result;
          db.onversionchange = () => { db.close(); idbP = null; };
          db.onclose = () => { idbP = null; };
          res(db);
        };
        r.onerror = () => rej(r.error || new Error('idb'));
        r.onblocked = () => rej(new Error('blocked'));
      });
      idbP.catch(() => { idbP = null; });
    }
    return idbP;
  }
  async function idbRun(stores, mode, fn, again) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const t = db.transaction(stores, mode);
        let out;
        const r = fn(t);
        if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error || new Error('idb'));
        t.onabort = () => rej(t.error || new Error('abort'));
      });
    } catch (e) {
      if (again) throw e;
      idbP = null; // Safari verliert die Verbindung manchmal: einmal neu versuchen
      return idbRun(stores, mode, fn, true);
    }
  }
  const Store = {
    all: () => idbRun('req', 'readonly', t => t.objectStore('req').getAll()),
    get: id => idbRun('req', 'readonly', t => t.objectStore('req').get(id)),
    put: rec => idbRun('req', 'readwrite', t => t.objectStore('req').put(rec)),
    patch: (id, changes) => idbRun('req', 'readwrite', t => {
      const st = t.objectStore('req');
      const g = st.get(id);
      g.onsuccess = () => { if (g.result) st.put(Object.assign(g.result, changes)); };
    }),
    pdf: id => idbRun('pdf', 'readonly', t => t.objectStore('pdf').get(id)),
    putPdf: (id, bytes) => idbRun('pdf', 'readwrite', t => t.objectStore('pdf').put({ id: id, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })),
    remove: id => idbRun(['req', 'pdf'], 'readwrite', t => { t.objectStore('req').delete(id); t.objectStore('pdf').delete(id); })
  };
  function askPersist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* egal */ }
  }
  const cleanLabel = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const txt = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';

  async function loadInbox() {
    try {
      const list = await Store.all();
      S.inbox.list = Array.isArray(list) ? list : [];
      S.inbox.ok = true;
    } catch (e) {
      console.warn('Übersicht:', e);
      S.inbox.ok = false;
      S.inbox.list = [];
    }
    return S.inbox.list;
  }

  let pendingOpen = null;
  function initInbox() {
    serverStatus().then(syncMailFlag).catch(() => {});
    try { S.inbox.filter = localStorage.getItem(LS_FILTER) || 'all'; } catch (e) { /* egal */ }
    if (!/^(all|open|signed)$/.test(S.inbox.filter)) S.inbox.filter = 'all';
    loadInbox().then(() => { renderInbox(); return refreshInbox(); }).then(() => {
      if (pendingOpen) { const id = pendingOpen; pendingOpen = null; openRecord(id); }
    });
  }

  function whenText(ts) {
    const d = new Date(ts), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / DAY);
    const t = fmtTime(d);
    if (diff === 0) return 'heute, ' + t;
    if (diff === 1) return 'gestern, ' + t;
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + (d.getFullYear() !== now.getFullYear() ? d.getFullYear() : '') + ', ' + t;
  }
  function leftText(exp) {
    const days = Math.ceil((exp - Date.now()) / DAY);
    return days <= 0 ? 'läuft heute ab' : days === 1 ? 'noch 1 Tag gültig' : 'noch ' + days + ' Tage gültig';
  }
  const recTitle = r => r.label || (r.status === 'signed' && r.signer) || r.title || r.file || 'Dokument';
  // Dokument eines Eintrags: Titel (neu) oder Dateiname, bei mehreren PDFs mit Anzahl
  const recDoc = r => (r.title || r.file || 'Dokument') + (r.parts > 1 ? ' (' + r.parts + ' PDFs)' : '');
  const signersOf = r => [r.signer, r.signer2].filter(Boolean).join(' und ');
  const hasIssue = r => Array.isArray(r.issues) && r.issues.length > 0;
  const pending = r => r.status === 'open' || (r.status === 'signed' && !r.local && !r.lost);

  function setFilter(f) {
    if (!/^(all|open|signed)$/.test(String(f))) return;
    S.inbox.filter = f;
    try { localStorage.setItem(LS_FILTER, f); } catch (e) { /* egal */ }
    renderInbox();
  }

  // Suchfeld bleibt beim Neuzeichnen stehen (behält beim Tippen den Fokus)
  let searchWrap = null;
  function searchBox() {
    if (searchWrap) return searchWrap;
    const q = el('input', { class: 'in', type: 'search', placeholder: 'Suchen: Kunde, Notiz, Datei …', 'aria-label': 'Anfragen durchsuchen', autocomplete: 'off', enterkeyhint: 'search', maxlength: '60' });
    q.addEventListener('input', () => { S.inbox.q = q.value; renderInbox(); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q.blur(); } });
    searchWrap = el('div', { class: 'search', role: 'search' }, el('span', { html: I.search }), q);
    return searchWrap;
  }
  const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  function matches(r, words) {
    if (!words.length) return true;
    const hay = fold([r.label, r.label2, r.note, r.file, r.title, r.outName, r.signer, r.signer2, r.ort, r.created ? fmtDate(new Date(r.created)) : '', r.signedAt ? fmtDate(new Date(r.signedAt)) : ''].join(' '));
    return words.every(w => hay.indexOf(w) >= 0);
  }

  function renderTiles(list) {
    const tiles = $('#tiles');
    if (!tiles) return;
    tiles.innerHTML = '';
    const show = S.mode === 'send' && S.inbox.ok && list.length > 0;
    tiles.classList.toggle('hidden', !show);
    if (!show) return;
    const f = S.inbox.filter;
    const nNew = list.filter(r => r.status === 'signed' && r.local && !r.seen).length;
    const nIssue = list.filter(r => r.status === 'open' && r.issueNew).length;
    [['all', 'Alle', list.length], ['open', 'Offen', list.filter(r => r.status === 'open').length], ['signed', 'Erledigt', list.filter(r => r.status === 'signed').length]].forEach(x => {
      tiles.append(el('button', { type: 'button', class: 'tile' + (f === x[0] ? ' on' : ''), 'aria-pressed': f === x[0] ? 'true' : 'false',
        onclick: () => {
          setFilter(x[0]);
          const box = $('#inbox');
          if (box && box.getBoundingClientRect().top > window.innerHeight * 0.75) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } },
      el('b', null, String(x[2]), x[0] === 'signed' && nNew ? el('i', { title: nNew + ' neu' }) : x[0] === 'open' && nIssue ? el('i', { class: 'issue', title: nIssue + ' ' + plural(nIssue, 'Rückmeldung', 'Rückmeldungen') }) : null),
      el('span', { text: x[1] })));
    });
  }

  function renderInbox() {
    const box = $('#inbox');
    if (!box) return;
    const send = S.mode === 'send';
    const list = send ? S.inbox.list.slice() : [];
    const has = list.length > 0;
    if (send) setText('#pickLabel', has ? 'Neue Anfrage' : 'PDF auswählen');
    box.classList.toggle('hidden', !send || (!has && S.inbox.ok));
    const start = $('#start');
    if (start) start.classList.toggle('has-inbox', send && has);
    renderTiles(list);
    const sw = searchBox();
    Array.from(box.children).forEach(n => { if (n !== sw) n.remove(); });
    if (!send) return;
    box.setAttribute('aria-label', 'Ihre Anfragen');
    const before = [], after = [];
    const place = () => {
      if (sw.parentNode !== box) box.append(sw);
      before.forEach(n => box.insertBefore(n, sw));
      after.forEach(n => box.append(n));
    };
    if (!S.inbox.ok) {
      sw.classList.add('hidden');
      before.push(el('div', { class: 'banner warn' }, el('span', { html: I.warn }),
        el('p', { text: 'Die Übersicht kann in diesem Browser nicht gespeichert werden (zum Beispiel im privaten Modus). Links funktionieren trotzdem, Ihr Kunde schickt das PDF dann per WhatsApp zurück.' })));
      place();
      return;
    }
    if (!has) { sw.classList.add('hidden'); place(); return; }
    const f = S.inbox.filter;
    const words = fold(S.inbox.q || '').split(/\s+/).filter(Boolean);
    const isNew = r => (r.status === 'signed' && r.local && !r.seen) || (r.status === 'open' && !!r.issueNew);
    const inFilter = list.filter(r => f === 'all' || r.status === f);
    const rows = inFilter.filter(r => matches(r, words))
      .sort((a, b) => isNew(b) - isNew(a) || (b.signedAt || b.created) - (a.signedAt || a.created));
    before.push(el('div', { class: 'ibhead' },
      el('h2', { text: f === 'open' ? 'Offene Anfragen' : f === 'signed' ? 'Erledigt' : 'Ihre Anfragen' }),
      el('button', { type: 'button', class: 'iconbtn sm' + (refreshing ? ' turning' : ''), 'aria-label': 'Aktualisieren', html: I.refresh, onclick: () => refreshInbox(true) })));
    if (pushAskVisible()) {
      before.push(el('div', { class: 'askpush' },
        el('span', { html: I.bell }),
        el('div', { class: 'grow' }, el('b', { text: 'Bescheid bekommen?' }), el('span', { text: 'Eine Benachrichtigung, sobald ein Kunde unterschrieben hat, und eine Erinnerung, wenn etwas liegen bleibt.' })),
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Einschalten', onclick: () => enablePush() }),
        el('button', { type: 'button', class: 'x', 'aria-label': 'Hinweis ausblenden', text: '×', onclick: () => { setLS(LS_PUSHASK, '1'); renderInbox(); } })));
    }
    if (S.mailErr && mailEnabled()) {
      before.push(el('div', { class: 'banner warn' }, el('span', { html: I.mail }),
        el('p', { text: 'Die Kopie per E-Mail klappt gerade nicht: ' + (S.mailErr === 'mail_auth' || S.mailErr === 'mail_apppw'
          ? 'Google lehnt die Anmeldung ab (App-Passwort geändert oder widerrufen?).' : 'Der Mail-Dienst lehnt ab.') + ' Bitte in den Einstellungen neu einrichten. Die PDFs liegen sicher hier.' }),
        el('button', { type: 'button', class: 'act', text: 'Öffnen', onclick: () => openSettings() })));
    }
    const bk = backupNeeded(list);
    if (bk) {
      before.push(el('div', { class: 'backupcard' },
        el('div', { class: 'grow' }, el('b', { text: 'Sicherung empfohlen' }),
          el('span', { text: bk + ' ' + plural(bk, 'unterschriebenes PDF liegt', 'unterschriebene PDFs liegen') + ' nur auf diesem Gerät.' })),
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Sichern', onclick: () => makeBackup() }),
        el('button', { type: 'button', class: 'x', 'aria-label': 'Später', text: '×', onclick: () => { setLS(LS_BACKUPASK, String(Date.now())); renderInbox(); } })));
    }
    sw.classList.toggle('hidden', list.length < 4 && !words.length);
    if (rows.length) {
      const ul = el('ul', { class: 'iblist' });
      rows.forEach(r => ul.append(el('li', null, itemButton(r))));
      after.push(ul);
    } else if (words.length) {
      const all = list.filter(r => matches(r, words)).length;
      after.push(el('div', { class: 'ibempty' }, el('p', { text: 'Keine Treffer' + (f !== 'all' ? ' unter „' + (f === 'open' ? 'Offen' : 'Erledigt') + '“.' : '.') }),
        f !== 'all' && all ? el('button', { type: 'button', class: 'linkbtn strong', text: all + ' ' + plural(all, 'Treffer', 'Treffer') + ' in allen Anfragen zeigen', onclick: () => setFilter('all') }) : null));
    } else {
      after.push(el('div', { class: 'ibempty' }, el('p', { text: f === 'open' ? 'Keine offenen Anfragen. Alles unterschrieben!' : 'Noch nichts unterschrieben.' })));
    }
    const err = S.inbox.err;
    after.push(el('p', { class: 'ibnote' + (err ? ' warn' : ''), text:
      err === 'pin' ? 'Für den Abgleich fehlt die PIN. Tippen Sie oben auf Aktualisieren.'
        : err === 'offline' ? 'Keine Verbindung' + (S.inbox.last ? ', Stand ' + fmtTime(new Date(S.inbox.last)) + ' Uhr.' : '.') + ' Unterschriebene PDFs liegen nur auf diesem Gerät.'
          : (S.inbox.last ? 'Aktualisiert ' + fmtTime(new Date(S.inbox.last)) + ' Uhr. ' : '') + 'Unterschriebene PDFs liegen nur auf diesem Gerät.' }));
    place();
  }

  function dayText(ts) {
    const d = new Date(ts), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / DAY);
    return diff === 0 ? 'heute' : diff === 1 ? 'gestern' : 'am ' + pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.';
  }
  // Kalendertage seit ts (heute = 0, gestern = 1)
  function calDays(ts) {
    const d = new Date(ts), n = new Date();
    return Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  }
  function openSince(r) {
    const days = calDays(r.created);
    return days < 2 ? 'gesendet ' + whenText(r.created) : 'seit ' + days + ' Tagen offen';
  }

  function itemButton(r) {
    const st = r.status, title = recTitle(r);
    let cls, icon, pill, when, extra = null, due = false;
    if (st === 'signed') {
      cls = 'ok'; icon = I.check; pill = 'Unterschrieben';
      const who = signersOf(r);
      when = whenText(r.signedAt) + (!who || title === who ? '' : r.signer2 && title === r.signer ? ', mit ' + r.signer2 : ', ' + who);
      if (!r.local) when += r.lost ? ', PDF nicht mehr abrufbar' : ', wird geladen …';
      if (r.inPerson) extra = el('i', { class: 'pill here', text: 'Vor Ort' });
    } else if (st === 'open') {
      cls = 'open'; icon = I.clock; pill = 'Offen';
      const left = Math.ceil((r.expires - Date.now()) / DAY);
      due = left <= 1 || calDays(r.created) >= 2;
      when = openSince(r) + ', ' + leftText(r.expires) + (r.remindedAt ? ', erinnert ' + dayText(r.remindedAt) : '');
      // Rückmeldung des Kunden geht vor, sonst „geöffnet“
      if (hasIssue(r)) extra = el('i', { class: 'pill issue', text: 'Rückmeldung' });
      else if (r.openedAt) extra = el('i', { class: 'pill seen', text: 'Geöffnet' });
    } else {
      cls = 'gone'; icon = I.xc; pill = r.gone === 'withdrawn' ? 'Zurückgezogen' : 'Abgelaufen';
      when = 'nicht unterschrieben';
    }
    const doc = recDoc(r);
    const sub = [r.note, title !== doc && title !== r.file ? doc : ''].filter(Boolean).join(' · ');
    return el('button', { type: 'button', class: 'ibitem ' + cls, onclick: () => openRecord(r.id) },
      el('span', { class: 'ic', html: icon }),
      el('span', { class: 'tx' },
        el('b', null, el('span', { class: 'ttl', text: title }), st === 'signed' && r.local && !r.seen ? el('i', { class: 'pill new', text: 'Neu' }) : null),
        sub ? el('small', { text: sub }) : null,
        st === 'open' && hasIssue(r) ? el('small', { class: 'issue', text: '„' + r.issues[r.issues.length - 1].text + '“' }) : null,
        el('span', { class: 'st' }, el('i', { class: 'pill ' + cls, text: pill }), extra, el('span', { class: due ? 'due' : null, text: when }))),
      el('span', { class: 'chev', html: I.chev }));
  }

  // Stand beim Server abfragen, neu unterschriebene PDFs abholen und dort löschen
  let refreshing = null, pollT = 0;
  function refreshInbox(manual) {
    if (S.mode !== 'send') return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = syncInbox(!!manual)
      .then(retryMails)
      .catch(e => console.warn('Abgleich:', e))
      .then(() => { refreshing = null; renderInbox(); schedulePoll(); });
    renderInbox();
    return refreshing;
  }
  function schedulePoll() {
    clearTimeout(pollT);
    if (S.mode !== 'send' || !S.inbox.list.some(pending)) return;
    pollT = setTimeout(() => {
      if (document.visibilityState === 'visible' && !S.inViewer) refreshInbox(); else schedulePoll();
    }, 30000);
  }

  async function syncInbox(manual) {
    await loadInbox();
    if (!S.inbox.ok) return;
    const now = Date.now();
    for (const r of S.inbox.list) {
      if (r.status === 'gone' && now - (r.goneAt || r.expires || now) > 30 * DAY) await Store.remove(r.id).catch(() => {});
    }
    const ask = S.inbox.list.filter(pending);
    const tidy = S.inbox.list.filter(r => r.status === 'signed' && r.local && !r.serverGone);
    if (!ask.length && !tidy.length) { S.inbox.err = ''; await loadInbox(); return; }
    let pin = getPin();
    if (!pin) {
      if (manual) pin = await askPin();
      if (!pin) { S.inbox.err = 'pin'; return; }
    }
    let states = {};
    if (ask.length) {
      try {
        states = (await apiJSON('POST', '/api/state', { pin: pin, json: { ids: ask.map(r => r.id) } })).states || {};
      } catch (e) {
        S.inbox.err = e.code === 'pin_wrong' ? 'pin' : 'offline';
        if (e.code === 'pin_wrong') setPin('');
        return;
      }
    }
    S.inbox.err = '';
    S.inbox.last = Date.now();
    const fresh = [], withIssue = [];
    for (const r of ask) {
      if (!Object.prototype.hasOwnProperty.call(states, r.id)) continue;
      const st = states[r.id];
      if (!st) {
        // Beim Server nicht (mehr) vorhanden
        if (r.status === 'open') await Store.patch(r.id, { status: 'gone', gone: 'expired', goneAt: now });
        else await Store.patch(r.id, { lost: true });
      } else if (st.status === 'signed' && !st.chunks) {
        // Unterschrieben, aber nichts mehr zum Abholen da
        await Store.patch(r.id, { status: 'signed', signedAt: st.signedAt, lost: true });
      } else if (st.status === 'signed') {
        if (r.status !== 'signed') await Store.patch(r.id, { status: 'signed', signedAt: st.signedAt, seen: false });
        fresh.push(Object.assign({}, r, { signedAt: st.signedAt, sChunks: st.chunks, sMailed: !!st.mailed }));
      } else {
        // Offen: Ablauf, „geöffnet“ und neue Rückmeldungen des Kunden
        const ch = {};
        if (st.expires && st.expires !== r.expires) ch.expires = st.expires;
        if (st.opened && st.opened !== r.openedAt) ch.openedAt = st.opened;
        if (Object.keys(ch).length) await Store.patch(r.id, ch);
        if (st.issues > 0) withIssue.push(r);
      }
    }
    const said = [];
    for (const r of withIssue) {
      try { if (await fetchIssues(r, pin)) said.push(recTitle(r)); } catch (e) { console.warn('Rückmeldung:', e); }
    }
    await loadInbox();
    renderInbox();
    if (said.length) toast(said.length === 1 ? 'Rückmeldung zu ' + said[0] + ': Bitte ansehen.' : said.length + ' neue Rückmeldungen', 5000);
    const names = [];
    for (const r of fresh) {
      try {
        const rec = await fetchSigned(r, pin);
        names.push(recTitle(rec));
      } catch (e) { console.warn('Abholen:', e); }
      await loadInbox();
      renderInbox();
    }
    for (const r of tidy) await deleteServerCopy(r.id, pin);
    await loadInbox();
    if (names.length) toast(names.length === 1 ? 'Neu unterschrieben: ' + names[0] : names.length + ' Dokumente neu unterschrieben', 4500);
  }

  async function fetchSigned(r, pin) {
    const n = Number(r.sChunks) || 0;
    if (!n) throw new Error('chunks');
    const parts = [];
    for (let i = 0; i < n; i++) {
      const res = await apiRetry('GET', '/api/doc/' + encodeURIComponent(r.id) + '/signed/' + i, { pin: pin });
      parts.push(new Uint8Array(await res.arrayBuffer()));
    }
    const doc = await decryptDoc(concatBytes(parts), r.key);
    if (!looksLikePdf(doc.bytes)) throw new Error('format');
    await Store.putPdf(r.id, doc.bytes);
    const chk = await Store.pdf(r.id);
    if (!chk || !chk.bytes || chk.bytes.byteLength !== doc.bytes.length) throw new Error('save');
    const h = doc.head || {};
    const changes = {
      status: 'signed', local: true, lost: false, seen: false,
      outName: cleanName(txt(h.name, 120) || r.file),
      signer: txt(h.signer, 80), signer2: txt(h.signer2, 80), ort: txt(h.ort, 60),
      title: r.title || txt(h.title, 80),
      outPages: Number.isInteger(h.pages) && h.pages > 0 ? h.pages : 0,
      size: doc.bytes.length,
      signedAt: r.signedAt || Date.parse(h.signedAt) || Date.now()
    };
    if (r.sMailed) changes.mailed = changes.signedAt; // der Kunde hat die Mail-Kopie schon geschickt
    else if (mailEnabled()) changes.mailPending = true;
    await Store.patch(r.id, changes);
    if (changes.mailPending) await mailFromPhone(Object.assign({}, r, changes), doc.bytes); // Ersatzweg
    await deleteServerCopy(r.id, pin); // liegt jetzt nur noch auf diesem Gerät
    return Object.assign({}, r, changes);
  }
  // Rückmeldungen des Kunden („Stimmt etwas nicht?“) abholen, mit dem Schlüssel der Anfrage entschlüsseln, beim Server löschen
  async function fetchIssues(r, pin) {
    const res = await apiJSON('GET', '/api/doc/' + encodeURIComponent(r.id) + '/issue', { pin: pin });
    const list = Array.isArray(res.issues) ? res.issues : [];
    if (!list.length) return 0;
    const have = Array.isArray(r.issues) ? r.issues.slice() : [];
    let upTo = 0, added = 0;
    for (const x of list) {
      const at = Number(x && x.at) || 0;
      upTo = Math.max(upTo, at);
      if (!at || have.some(h => h.at === at)) continue;
      let text = '';
      try { const o = await openHead(String(x.msg || ''), r.key); text = typeof o.m === 'string' ? o.m.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, 1000) : ''; } catch (e) { text = ''; }
      if (!text) continue;
      have.push({ at: at, text: text });
      added++;
    }
    if (added) await Store.patch(r.id, { issues: have.slice(-10), issueNew: true });
    if (upTo) await apiFetch('POST', '/api/doc/' + encodeURIComponent(r.id) + '/issue/clear', { pin: pin, json: { upTo: upTo } }).catch(() => {});
    return added;
  }
  async function deleteServerCopy(id, pin) {
    try { await apiFetch('DELETE', '/api/doc/' + encodeURIComponent(id), { pin: pin }); } catch (e) {
      if (e.status !== 404 && e.status !== 410) return false;
    }
    await Store.patch(id, { serverGone: true }).catch(() => {});
    return true;
  }

  function askPin() {
    return new Promise(resolve => {
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      const input = el('input', { class: 'in', type: 'password', placeholder: 'Ihre Absender-PIN', autocomplete: 'current-password', maxlength: '64' });
      const err = el('p', { class: 'err', role: 'alert' });
      const go = async () => {
        const pin = input.value.trim();
        if (pin.length < 6) { err.textContent = 'Die PIN hat mindestens 6 Zeichen.'; return; }
        busy('PIN wird geprüft …');
        try {
          await apiJSON('POST', '/api/pin', { json: { pin: pin } });
          unbusy();
          setPin(pin);
          done(pin);
          closeSheet();
        } catch (e) {
          unbusy();
          err.textContent = e.code === 'pin_wrong' ? 'Die PIN stimmt nicht.' : 'Keine Verbindung. Bitte später noch einmal versuchen.';
        }
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      openSheet('PIN eingeben', el('div', null,
        el('p', { class: 'prose', text: 'Damit Firmio den Stand Ihrer Anfragen abrufen kann, braucht dieses Gerät Ihre Absender-PIN.' }),
        el('label', { class: 'fld' }, el('span', { text: 'Absender-PIN' }), input), err,
        el('button', { type: 'button', class: 'btn btn-primary btn-block', html: I.check + '<span>Weiter</span>', onclick: go })),
      { onClose: () => done('') });
      setTimeout(() => { try { input.focus(); } catch (e) { /* egal */ } }, 330);
    });
  }

  function reminderMessage(r) {
    const name = loadSender().name || '';
    const du = r.du !== false, sq = r.lang === 'sq';
    const intro = sq
      ? (du ? 'Një kujtesë e vogël: dokumenti yt pret ende nënshkrimin tënd. Hape linkun dhe nënshkruaje me gisht:' : 'Një kujtesë e vogël: dokumenti juaj pret ende nënshkrimin tuaj. Hapeni linkun dhe nënshkruajeni me gisht:')
      : (du ? 'Kurze Erinnerung: Dein Dokument wartet noch auf deine Unterschrift. Öffne einfach den Link und unterschreib mit dem Finger:' : 'Kurze Erinnerung: Ihr Dokument wartet noch auf Ihre Unterschrift. Öffnen Sie einfach den Link und unterschreiben Sie mit dem Finger:');
    return intro + '\n' + r.link + '\n\n' + msgValid(sq ? 'sq' : 'de', r.expires) + (sq ? 'Faleminderit!' : 'Vielen Dank!') + sign(name);
  }

  async function withPdf(r, fn) {
    let p = null;
    try { p = await Store.pdf(r.id); } catch (e) { p = null; }
    if (!p || !p.bytes) { toast('Das PDF ist auf diesem Gerät nicht vorhanden.'); return; }
    await fn(new Uint8Array(p.bytes), r.outName || r.file);
  }

  async function viewRecord(r) {
    let p = null;
    try { p = await Store.pdf(r.id); } catch (e) { p = null; }
    if (!p || !p.bytes) { toast('Das PDF ist auf diesem Gerät nicht vorhanden.'); return; }
    closeSheet(true);
    S.view = r.id;
    const ok = await openBytes(new Uint8Array(p.bytes), r.outName || r.file, false);
    if (!ok) S.view = null;
  }

  async function removeRecord(r) {
    const local = r.status === 'signed' && r.local;
    if (!confirm(local ? 'Unterschriebenes PDF von diesem Gerät löschen? Haben Sie es weitergeleitet oder gespeichert?' : 'Aus der Übersicht entfernen?')) return;
    if (r.status === 'signed' && !r.serverGone) {
      const pin = getPin();
      if (pin) await deleteServerCopy(r.id, pin);
    }
    try { await Store.remove(r.id); } catch (e) { toast('Löschen hat nicht geklappt.'); return; }
    closeSheet();
    await loadInbox();
    renderInbox();
    toast(local ? 'PDF gelöscht.' : 'Entfernt.');
  }

  async function withdrawRecord(r) {
    if (!confirm('Anfrage zurückziehen? Der Link funktioniert danach nicht mehr.')) return;
    const pin = getPin() || await askPin();
    if (!pin) return;
    busy('Einen Moment …');
    try {
      const st = ((await apiJSON('POST', '/api/state', { pin: pin, json: { ids: [r.id] } })).states || {})[r.id];
      if (st && st.status === 'signed') {
        unbusy();
        closeSheet();
        toast('Ihr Kunde hat gerade unterschrieben.');
        refreshInbox(true);
        return;
      }
      if (st) await apiFetch('DELETE', '/api/doc/' + encodeURIComponent(r.id), { pin: pin });
      await Store.patch(r.id, { status: 'gone', gone: 'withdrawn', goneAt: Date.now() });
      unbusy();
      closeSheet();
      await loadInbox();
      renderInbox();
      toast('Anfrage zurückgezogen.');
    } catch (e) {
      unbusy();
      toast(e.code === 'pin_wrong' ? 'Die PIN stimmt nicht.' : 'Hat nicht geklappt. Bitte Internetverbindung prüfen.');
    }
  }

  // Rückmeldungen des Kunden („Stimmt etwas nicht?“), neueste zuerst
  function issueBox(r) {
    const dtx = ts => fmtDate(new Date(ts)) + ', ' + fmtTime(new Date(ts)) + ' Uhr';
    return el('div', { class: 'banner warn issuebox' }, el('span', { html: I.warn }),
      el('div', { class: 'grow' },
        el('b', { text: r.issues.length === 1 ? 'Rückmeldung von Ihrem Kunden' : r.issues.length + ' Rückmeldungen von Ihrem Kunden' }),
        ...r.issues.slice().reverse().slice(0, 4).map(x => el('p', null, el('q', { text: x.text }), el('small', { text: dtx(x.at) }))),
        r.status === 'open' ? el('p', { class: 'tip', text: 'Am besten das PDF korrigieren und neu senden. Diese Anfrage dann zurückziehen.' }) : null));
  }
  async function openRecord(id) {
    let r = null;
    try { r = await Store.get(id); } catch (e) { r = null; }
    if (!r) { await loadInbox(); renderInbox(); return; }
    if (r.status === 'signed' && r.local && !r.seen) {
      Store.patch(id, { seen: true }).then(loadInbox).then(renderInbox).catch(() => {});
    } else if (r.issueNew) {
      Store.patch(id, { issueNew: false }).then(loadInbox).then(renderInbox).catch(() => {});
    }
    const kv = el('dl', { class: 'kv' });
    const row = (k, v) => { if (v) kv.append(el('dt', { text: k }), el('dd', { text: v })); };
    const dt = ts => fmtDate(new Date(ts)) + ', ' + fmtTime(new Date(ts)) + ' Uhr';
    const label = el('input', { class: 'in', type: 'text', value: r.label || '', placeholder: 'z. B. Max Mustermann', maxlength: '80', autocomplete: 'off' });
    const noteIn = el('input', { class: 'in', type: 'text', value: r.note || '', placeholder: 'z. B. Rückruf am Montag', maxlength: '80', autocomplete: 'off' });
    const saveNote = () => { Store.patch(id, { label: cleanLabel(label.value), note: cleanLabel(noteIn.value) }).then(loadInbox).then(renderInbox).catch(() => {}); };
    label.addEventListener('change', saveNote);
    noteIn.addEventListener('change', saveNote);
    const note = el('div', { class: 'recnote' },
      el('label', { class: 'fld' }, el('span', { text: 'Kunde (nur für Sie)' }), label),
      el('label', { class: 'fld' }, el('span', { text: 'Notiz' }), noteIn));
    const body = el('div', { class: 'recdetail' });
    const add = (...xs) => body.append(...xs.filter(Boolean)); // ohne leere Einträge (sonst steht „null“ da)
    if (r.status === 'signed') {
      row('Unterschrieben von', signersOf(r));
      row('Dokument', recDoc(r));
      row('Zeitpunkt', r.signedAt ? dt(r.signedAt) : '');
      row('Ort', r.ort);
      if (r.inPerson) row('Art', 'Vor Ort auf diesem Gerät');
      else row('Angefordert', fmtDate(new Date(r.created)));
      row('E-Mail', r.mailed ? 'Kopie verschickt' : r.mailPending ? 'wird verschickt, sobald Internet da ist' : '');
      if (r.local) {
        const info = (r.outPages ? (r.outPages === 1 ? '1 Seite' : r.outPages + ' Seiten') + ' · ' : '') + fmtSize(r.size || 0);
        add(
          el('div', { class: 'filecard' }, el('span', { html: I.doc }), el('div', null, el('b', { text: r.outName || r.file }), el('span', { text: info }))),
          kv,
          hasIssue(r) ? issueBox(r) : null,
          el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.eye + '<span>Ansehen</span>', onclick: () => viewRecord(r) }),
          el('div', { class: 'btnrow' },
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.share + '<span>Teilen</span>', onclick: () => withPdf(r, shareFile) }),
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.download + '<span>Speichern</span>', onclick: () => withPdf(r, (b, n) => { download(b, n); toast('PDF wird gespeichert.'); }) })),
          el('p', { class: 'hint left', text: 'Das PDF liegt nur auf diesem Gerät. Leiten Sie es am besten gleich weiter, zum Beispiel in die Kundenakte.' }),
          note,
          el('div', { class: 'donelinks' }, el('button', { type: 'button', class: 'linkbtn danger', text: 'Von diesem Gerät löschen', onclick: () => removeRecord(r) })));
      } else {
        add(kv,
          el('div', { class: 'banner' + (r.lost ? ' warn' : '') }, el('span', { html: r.lost ? I.warn : I.info }),
            el('p', { text: r.lost ? 'Das unterschriebene PDF ist auf dem Server nicht mehr vorhanden. Bitten Sie Ihren Kunden, es per WhatsApp zu schicken.' : 'Ihr Kunde hat unterschrieben. Das PDF wird gerade abgeholt.' })),
          r.lost ? null : el('button', { type: 'button', class: 'btn btn-primary btn-block', html: I.download + '<span>Jetzt abholen</span>', onclick: async () => { closeSheet(); await refreshInbox(true); openRecord(id); } }),
          note,
          el('div', { class: 'donelinks' }, el('button', { type: 'button', class: 'linkbtn danger', text: 'Aus der Übersicht entfernen', onclick: () => removeRecord(r) })));
      }
    } else if (r.status === 'open') {
      row('Dokument', recDoc(r));
      if (r.label2) row('2. Person', r.label2);
      row('Gesendet', dt(r.created));
      row('Gültig bis', fmtDate(new Date(r.expires)) + ' (' + leftText(r.expires) + ')');
      row('Sprache', (r.lang === 'sq' ? 'Shqip (Albanisch)' : 'Deutsch') + (r.du === false ? ', Sie' : ', Du'));
      row('Geöffnet', r.openedAt ? dt(r.openedAt) : 'noch nicht');
      row('Erinnert', r.remindedAt ? dt(r.remindedAt) : '');
      const days = calDays(r.created), issue = hasIssue(r);
      add(
        issue ? issueBox(r) : el('div', { class: 'banner' + (days >= 2 ? ' warn' : '') }, el('span', { html: I.clock }), el('p', { text: days >= 2
          ? (r.openedAt ? 'Geöffnet, aber seit ' + days + ' Tagen nicht unterschrieben. Eine kurze Erinnerung hilft oft.' : 'Seit ' + days + ' Tagen nicht unterschrieben. Eine kurze Erinnerung hilft oft.')
          : r.openedAt ? 'Ihr Kunde hat den Link geöffnet, aber noch nicht unterschrieben.' : 'Noch nicht unterschrieben. Sobald Ihr Kunde fertig ist, erscheint das PDF hier.' })),
        kv,
        r.link && !issue ? el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.bell + '<span>Erinnerung senden</span>', onclick: async () => {
          if (!(await shareMessage(reminderMessage(r)))) return;
          await Store.patch(r.id, { remindedAt: Date.now() }).catch(() => {});
          await loadInbox();
          renderInbox();
        } }) : null,
        el('div', { class: 'btnrow' },
          r.link ? el('button', { type: 'button', class: 'btn btn-ghost', html: I.copy + '<span>Link kopieren</span>', onclick: () => copyText(r.link, 'Link kopiert.') }) : null,
          el('button', { type: 'button', class: 'btn btn-ghost', html: I.refresh + '<span>Status prüfen</span>', onclick: () => { closeSheet(); refreshInbox(true); } })),
        note,
        el('div', { class: 'donelinks' }, el('button', { type: 'button', class: 'linkbtn danger', text: 'Anfrage zurückziehen', onclick: () => withdrawRecord(r) })));
    } else {
      row('Dokument', recDoc(r));
      row('Gesendet', dt(r.created));
      add(
        el('div', { class: 'banner warn' }, el('span', { html: I.warn }), el('p', { text: r.gone === 'withdrawn'
          ? 'Sie haben diese Anfrage zurückgezogen. Der Link funktioniert nicht mehr.'
          : 'Der Link ist abgelaufen, ohne dass unterschrieben wurde. Wählen Sie das PDF erneut aus, um eine neue Anfrage zu senden.' })),
        kv, note,
        el('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Aus der Übersicht entfernen', onclick: () => removeRecord(r) }));
    }
    openSheet(recTitle(r), body);
  }

  /* ---------------- Benachrichtigungen (Web Push) ---------------- */
  const LS_PUSH = 'firmio.push.v1', LS_PUSHASK = 'firmio.pushask.v1', LS_PUSHSYNC = 'firmio.pushsync.v1';
  function getLS(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function setLS(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* egal */ } }
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  const pushOn = () => pushSupported() && getLS(LS_PUSH) === '1' && Notification.permission === 'granted';
  const pushAskVisible = () => S.mode === 'send' && pushSupported() && !pushOn() && Notification.permission !== 'denied' && !getLS(LS_PUSHASK);

  async function pushSubscribe(pin) {
    const reg = await navigator.serviceWorker.ready;
    const key = b64urlToBytes((await apiJSON('GET', '/api/push/key')).key);
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const old = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      const same = !!old && old.length === key.length && old.every((v, i) => v === key[i]);
      if (!same) { try { await sub.unsubscribe(); } catch (e) { /* egal */ } sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await apiJSON('POST', '/api/push/sub', { pin: pin, json: { sub: sub.toJSON() } });
    setLS(LS_PUSHSYNC, String(Date.now()));
    return sub;
  }
  async function enablePush() {
    if (!pushSupported()) { toast('Benachrichtigungen gehen in diesem Browser nicht.'); return false; }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Benachrichtigungen wurden nicht erlaubt.'); renderInbox(); return false; }
    const pin = getPin() || await askPin();
    if (!pin) return false;
    busy('Benachrichtigungen werden eingerichtet …');
    try {
      await pushSubscribe(pin);
      setLS(LS_PUSH, '1');
      unbusy();
      apiJSON('POST', '/api/push/test', { pin: pin, json: {} }).catch(() => {});
      toast('Benachrichtigungen sind an.');
      renderInbox();
      return true;
    } catch (e) {
      unbusy();
      console.warn('Benachrichtigungen:', e);
      toast(e && e.code === 'pin_wrong' ? 'Die PIN stimmt nicht.' : 'Hat nicht geklappt. Bitte später noch einmal versuchen.');
      return false;
    }
  }
  async function disablePush() {
    setLS(LS_PUSH, '');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const pin = getPin();
        if (pin) await apiJSON('POST', '/api/push/unsub', { pin: pin, json: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } catch (e) { /* egal */ }
    toast('Benachrichtigungen sind aus.');
    renderInbox();
  }
  // Anmeldung beim Server einmal am Tag auffrischen (falls sie dort verloren ging)
  async function keepPushAlive() {
    if (!pushOn() || Date.now() - Number(getLS(LS_PUSHSYNC) || 0) < DAY) return;
    const pin = getPin();
    if (!pin) return;
    try { await pushSubscribe(pin); } catch (e) { console.warn('Benachrichtigungen auffrischen:', e); }
  }

  /* ---------------- Kopie per E-Mail (Absender schaltet sie in den Einstellungen ein) ---------------- */
  // Der Server kennt Zugang und Zieladresse; hier merkt sich das Gerät nur, ob sie an ist (und an wen, für die Anzeige).
  const LS_MAIL = 'firmio.mail.v1';
  function getMailInfo() { try { const o = JSON.parse(localStorage.getItem(LS_MAIL)); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
  function setMailInfo(o) { try { if (o) localStorage.setItem(LS_MAIL, JSON.stringify(o)); else localStorage.removeItem(LS_MAIL); } catch (e) { /* egal */ } }
  const mailEnabled = () => !!getMailInfo();
  function syncMailFlag() {
    if (!S.server || !S.server.ok) return;
    if (!S.server.mail) setMailInfo(null);
    else if (!getMailInfo()) setMailInfo({ to: '', sender: '' });
  }
  const MAIL_ERR = {
    mail_to: 'Bitte die Adresse unter „An“ prüfen.',
    mail_user: 'Bitte Ihre Gmail-Adresse prüfen.',
    mail_apppw_format: 'Das App-Passwort hat 16 Buchstaben. Bitte noch einmal kopieren.',
    mail_auth: 'Google hat die Anmeldung abgelehnt. Stimmen Gmail-Adresse und App-Passwort?',
    mail_apppw: 'Google verlangt ein App-Passwort, nicht Ihr normales Passwort. Siehe „So bekommen Sie das App-Passwort“.',
    mail_conn: 'Gmail war gerade nicht erreichbar. Bitte gleich noch einmal versuchen.',
    mail_limit: 'Heute wurden schon sehr viele Mails verschickt. Morgen geht es wieder.',
    mail_off: 'Die Kopie per E-Mail ist ausgeschaltet.',
    pin_wrong: 'Die PIN stimmt nicht.',
    offline: 'Keine Verbindung. Bitte Internet prüfen.'
  };
  const mailErrText = code => MAIL_ERR[code] || 'Hat nicht geklappt. Bitte später noch einmal versuchen.';

  // Handy des Absenders schickt die Mail selbst: vor Ort, oder falls der Kunde sie nicht schicken konnte
  async function mailFromPhone(r, bytes) {
    if (!mailEnabled()) return false;
    const pin = getPin();
    if (!pin) return false;
    try {
      if (!bytes) {
        const p = await Store.pdf(r.id);
        if (!p || !p.bytes) return false;
        bytes = new Uint8Array(p.bytes);
      }
      const body = { id: r.id, name: r.outName || r.file, title: r.title || docTitleOf(r.file), signer: r.signer || '', signer2: r.signer2 || '', ort: r.ort || '', at: r.signedAt, via: r.inPerson ? 'local' : 'link', size: bytes.length };
      if (bytes.length > MAIL_MAX) body.big = true; else body.pdf = bytesToB64(bytes);
      const res = await apiJSON('POST', '/api/mail/send', { pin: pin, json: body });
      S.mailErr = '';
      await Store.patch(r.id, res.pending ? { mailPending: true } : { mailed: Date.now(), mailPending: false });
      return !res.pending;
    } catch (e) {
      console.warn('Kopie per E-Mail:', e);
      if (e && e.code === 'mail_off') { setMailInfo(null); await Store.patch(r.id, { mailPending: false }).catch(() => {}); }
      // Zugang klappt nicht mehr (z. B. App-Passwort widerrufen): in der Übersicht Bescheid geben
      if (e && /^mail_(auth|apppw|key|ip)$/.test(e.code || '')) S.mailErr = e.code;
      return false;
    }
  }
  // Mails, die noch nicht rausgingen (kein Internet, Gmail kurz weg), beim Abgleich nachholen
  async function retryMails() {
    if (!mailEnabled() || !S.inbox.ok) return;
    const list = S.inbox.list.filter(r => r.mailPending && r.status === 'signed' && r.local);
    for (const r of list) await mailFromPhone(r);
    if (list.length) await loadInbox();
  }

  /* ---------------- Einstellungen (Absender) ---------------- */
  function openSettings() {
    const p = loadSender();
    const clean = v => v.replace(/\s+/g, ' ').trim().slice(0, 60);
    const name = el('input', { class: 'in', type: 'text', value: p.name || '', placeholder: 'Vor- und Nachname', autocomplete: 'name', maxlength: '60' });
    const sub = el('input', { class: 'in', type: 'text', value: p.sub || '', placeholder: 'z. B. Versicherungen', autocomplete: 'off', maxlength: '60' });
    const prevMono = el('span', { class: 'mono' }), prevName = el('p', { class: 'lh-name' }), prevSub = el('p', { class: 'lh-sub' });
    const prevText = el('div', { class: 'lh-text' }, prevName, prevSub);
    prevText.insertAdjacentHTML('beforeend', STROKE);
    const preview = el('div', { class: 'lh-preview', 'aria-hidden': 'true' }, prevMono, prevText);
    const upd = () => {
      prevName.textContent = clean(name.value) || 'Firmio';
      prevSub.textContent = clean(sub.value);
      fillMono(prevMono, clean(name.value));
      saveSender(Object.assign(loadSender(), { name: clean(name.value), sub: clean(sub.value) }));
      renderLetterhead();
    };
    name.addEventListener('input', upd);
    sub.addEventListener('input', upd);
    const duBtns = [true, false].map(v => el('button', { type: 'button', class: 'seg' + ((p.du !== false) === v ? ' on' : ''), 'aria-pressed': (p.du !== false) === v ? 'true' : 'false', text: v ? 'Du' : 'Sie',
      onclick: () => {
        saveSender(Object.assign(loadSender(), { du: v }));
        duBtns.forEach((b, i) => { const on = [true, false][i] === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      } }));

    const pushBox = el('div');
    const renderPush = () => {
      pushBox.innerHTML = '';
      if (!pushSupported()) {
        pushBox.append(el('p', { class: 'prose', text: isIOS
          ? 'Auf dem iPhone geht das, wenn Firmio als App auf dem Home-Bildschirm liegt und Sie es von dort öffnen.'
          : 'In diesem Browser nicht möglich. Öffnen Sie Firmio in Chrome oder als installierte App.' }));
        return;
      }
      const denied = Notification.permission === 'denied', on = pushOn();
      pushBox.append(el('div', { class: 'setrow' },
        el('div', { class: 'grow' }, el('b', { text: 'Unterschrieben und Erinnerungen' }),
          el('span', { text: denied ? 'Im Browser blockiert. Erlauben Sie Benachrichtigungen in den Einstellungen des Browsers für diese Seite.'
            : 'Sofort, wenn ein Kunde unterschrieben hat. Dazu morgens ein Hinweis, wenn eine Anfrage seit 2 Tagen offen ist oder bald abläuft.' })),
        el('span', { class: 'state' + (on ? ' on' : ''), text: denied ? 'Blockiert' : on ? 'An' : 'Aus' })));
      if (denied) return;
      if (on) {
        pushBox.append(el('div', { class: 'btnrow' },
          el('button', { type: 'button', class: 'btn btn-ghost', html: I.bell + '<span>Test senden</span>', onclick: async () => {
            const pin = getPin();
            try { await apiJSON('POST', '/api/push/test', { pin: pin, json: {} }); toast('Test gesendet.'); } catch (e) { toast('Hat nicht geklappt.'); }
          } }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Ausschalten', onclick: async () => { await disablePush(); renderPush(); } })));
      } else {
        pushBox.append(el('button', { type: 'button', class: 'btn btn-primary btn-block', html: I.bell + '<span>Einschalten</span>', onclick: async () => { await enablePush(); renderPush(); } }));
      }
    };
    renderPush();

    const sigBox = el('div');
    const renderSig = () => {
      sigBox.innerHTML = '';
      const m = loadMySig();
      if (!m) {
        sigBox.append(el('p', { class: 'prose', text: 'Speichern Sie Ihre Unterschrift einmal. Firmio setzt sie dann automatisch dort ein, wo im Dokument „Unterschrift Vermittler“ steht (auch Berater, Vertreter, Makler) – bevor der Kunde das Dokument bekommt.' }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-block', html: I.pen + '<span>Unterschrift speichern</span>', onclick: () => openMySigPad(openSettings) }));
        return;
      }
      const prev = el('div', { class: 'mysig', 'aria-label': 'Ihre gespeicherte Unterschrift' });
      prev.innerHTML = '<svg viewBox="0 0 ' + r2(m.bw) + ' ' + r2(m.bh) + '" aria-hidden="true"><path d="' + m.path + '" fill="none" stroke="' + INK_CSS + '" stroke-width="' + r2(m.sw) + '" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      sigBox.append(prev,
        el('p', { class: 'hint left', text: 'Wird automatisch eingesetzt, wo „Unterschrift Vermittler“ steht. Im Dokument können Sie sie mit dem Stift oben rechts auch selbst setzen. Nur auf diesem Gerät gespeichert.' }),
        el('div', { class: 'btnrow' },
          el('button', { type: 'button', class: 'btn btn-ghost', html: I.redo + '<span>Neu zeichnen</span>', onclick: () => openMySigPad(openSettings) }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Löschen', onclick: () => {
            if (!confirm('Gespeicherte Unterschrift löschen?')) return;
            saveMySig(null);
            renderSig();
          } })));
    };
    renderSig();

    const mailBox = el('div');
    const renderMail = () => {
      mailBox.innerHTML = '';
      const info = getMailInfo();
      mailBox.append(el('p', { class: 'prose', text: 'Jedes unterschriebene PDF kommt automatisch zusätzlich per E-Mail, zum Beispiel in Ihr Büro-Postfach – sobald der Kunde fertig ist, auch wenn Firmio gerade nicht offen ist. Gesendet wird über Ihr Gmail-Konto.' }));
      if (info) {
        mailBox.append(el('div', { class: 'setrow' },
          el('div', { class: 'grow' }, el('b', { text: info.to ? 'An ' + info.to : 'Eingeschaltet' }), info.sender ? el('span', { text: 'Von ' + info.sender }) : null),
          el('span', { class: 'state on', text: 'An' })),
        el('div', { class: 'btnrow' },
          el('button', { type: 'button', class: 'btn btn-ghost', html: I.mail + '<span>Test-Mail</span>', onclick: async () => {
            const pin = getPin() || await askPin();
            if (!pin) return;
            busy('Test-Mail wird gesendet …');
            try { const r = await apiJSON('POST', '/api/mail/test', { pin: pin, json: {} }); unbusy(); toast('Test-Mail gesendet an ' + r.to + '.', 4000); } catch (e) {
              unbusy();
              if (e.code === 'mail_off') { setMailInfo(null); if (S.sheetOpen) renderMail(); }
              toast(mailErrText(e.code), 5000);
            }
          } }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Ausschalten', onclick: async () => {
            if (!confirm('Kopie per E-Mail ausschalten? Die Zugangsdaten werden vom Server gelöscht.')) return;
            const pin = getPin() || await askPin();
            if (!pin) return;
            busy('Einen Moment …');
            try {
              await apiJSON('POST', '/api/mail/off', { pin: pin, json: {} });
              setMailInfo(null);
              if (S.server) S.server.mail = false;
              unbusy();
              toast('Kopie per E-Mail ist aus.');
              if (S.sheetOpen) renderMail(); else openSettings();
            } catch (e) { unbusy(); toast(mailErrText(e.code), 5000); }
          } })));
        return;
      }
      const to = el('input', { id: 'mailTo', class: 'in', type: 'email', inputmode: 'email', placeholder: 'z. B. vorname.nachname@firma.de', autocomplete: 'off', maxlength: '160' });
      const user = el('input', { id: 'mailUser', class: 'in', type: 'email', inputmode: 'email', placeholder: 'name@gmail.com', autocomplete: 'off', maxlength: '160' });
      const pass = el('input', { id: 'mailPass', class: 'in', type: 'password', placeholder: '16 Buchstaben', autocomplete: 'new-password', autocapitalize: 'off', spellcheck: 'false', maxlength: '40' });
      const err = el('p', { class: 'err', role: 'alert' });
      const howto = el('details', { class: 'more howto' }, el('summary', { text: 'So bekommen Sie das App-Passwort' }),
        el('ol', { html:
          '<li>Im Google-Konto die <b>Bestätigung in zwei Schritten</b> einschalten (falls noch nicht an): <a href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noopener">öffnen</a></li>' +
          '<li><a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">App-Passwörter</a> öffnen, als Namen <b>Firmio</b> eingeben und auf <b>Erstellen</b> tippen.</li>' +
          '<li>Die 16 Buchstaben kopieren und oben einfügen. Leerzeichen sind egal.</li>' }));
      const go = async () => {
        err.textContent = '';
        const v = { to: to.value.trim(), user: user.value.trim(), pass: pass.value.replace(/\s+/g, '') };
        const okMail = x => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x);
        if (!okMail(v.to)) { err.textContent = mailErrText('mail_to'); to.focus(); return; }
        if (!okMail(v.user)) { err.textContent = mailErrText('mail_user'); user.focus(); return; }
        if (!/^[A-Za-z]{16}$/.test(v.pass)) { err.textContent = mailErrText('mail_apppw_format'); pass.focus(); return; }
        const pin = getPin() || await askPin();
        if (!pin) return;
        busy('Gmail wird geprüft …');
        try {
          const res = await apiJSON('POST', '/api/mail/setup', { pin: pin, json: v });
          setMailInfo({ to: res.to, sender: res.sender });
          if (S.server) S.server.mail = true;
          S.mailErr = '';
          busy('Test-Mail wird gesendet …');
          let sent = true;
          try { await apiJSON('POST', '/api/mail/test', { pin: pin, json: {} }); } catch (x) { sent = false; }
          unbusy();
          toast(sent ? 'Eingeschaltet. Eine Test-Mail ist unterwegs an ' + res.to + '.' : 'Eingeschaltet. Die Test-Mail ging nicht raus – bitte „Test-Mail“ tippen.', 5000);
          if (S.sheetOpen) renderMail(); else openSettings();
        } catch (e) {
          unbusy();
          if (S.sheetOpen) { err.textContent = mailErrText(e.code); return; }
          openSettings();
          toast(mailErrText(e.code), 6000);
        }
      };
      pass.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      mailBox.append(
        el('label', { class: 'fld' }, el('span', { text: 'An (zum Beispiel Ihr Büro-Postfach)' }), to),
        el('label', { class: 'fld' }, el('span', { text: 'Von (Ihr Gmail-Konto)' }), user),
        el('label', { class: 'fld' }, el('span', { text: 'App-Passwort von Google' }), pass),
        howto,
        el('p', { class: 'hint left', text: 'Gut zu wissen: Dafür läuft das PDF TLS-verschlüsselt über den Server statt nur Ende-zu-Ende verschlüsselt, und Gmail behält eine Kopie unter „Gesendet“. Ihre Kunden sehen das im Datenschutzhinweis. Das App-Passwort liegt nur auf dem Server, nicht auf diesem Handy.' }),
        err,
        el('button', { id: 'mailOn', type: 'button', class: 'btn btn-primary btn-block', html: I.mail + '<span>Kopie per E-Mail einschalten</span>', onclick: go }));
    };
    renderMail();

    const autoIn = el('input', { id: 'autoCust', type: 'checkbox' });
    autoIn.checked = autoCust();
    autoIn.addEventListener('change', () => { setLS(LS_AUTO, autoIn.checked ? '' : '0'); toast(autoIn.checked ? 'Unterschriftsfelder werden automatisch markiert.' : 'Unterschriftsfelder markieren Sie ab jetzt selbst.'); });
    const autoRow = el('label', { class: 'check' }, autoIn, el('span', null, 'Unterschriftsfelder des Kunden automatisch markieren',
      el('small', { text: 'Firmio sucht im PDF nach „Unterschrift Antragsteller“, „Versicherungsnehmer“, „Kontoinhaber“ und Ähnlichem und markiert die Linien dort. Ort/Datum setzen Sie selbst. Passt eine Vorlage, gilt die Vorlage.' })));
    const tplBox = el('div');
    const renderTpl = () => {
      tplBox.innerHTML = '';
      const list = loadTpls().sort((a, b) => (b.used || 0) - (a.used || 0));
      if (!list.length) {
        tplBox.append(el('p', { class: 'prose', text: 'Noch keine Vorlagen. Kreuzen Sie beim Senden „Felder als Vorlage merken“ an. Kommt das Formular wieder, setzt Firmio die Felder automatisch.' }));
        return;
      }
      const ul = el('ul', { class: 'tpllist' });
      list.forEach(t => ul.append(el('li', null,
        el('button', { type: 'button', class: 'grow', 'aria-label': 'Vorlage „' + t.name + '“ umbenennen', onclick: () => {
          const v = prompt('Name der Vorlage', t.name);
          if (v === null || !v.trim()) return;
          const all = loadTpls(), x = all.find(y => y.id === t.id);
          if (x) { x.name = v.replace(/\s+/g, ' ').trim().slice(0, 50); saveTpls(all); }
          renderTpl();
        } },
        el('b', { text: t.name }),
        el('span', { text: t.spots.length + ' ' + plural(t.spots.length, 'Feld', 'Felder') + ' · ' + t.pages + ' ' + plural(t.pages, 'Seite', 'Seiten') + ' · zuletzt ' + fmtDate(new Date(t.used || t.created)) })),
        el('button', { type: 'button', class: 'del', 'aria-label': 'Vorlage „' + t.name + '“ löschen', html: I.x, onclick: () => {
          if (!confirm('Vorlage „' + t.name + '“ löschen?')) return;
          saveTpls(loadTpls().filter(x => x.id !== t.id));
          renderTpl();
        } }))));
      tplBox.append(ul, el('p', { class: 'hint left', text: 'Antippen zum Umbenennen.' }));
    };
    renderTpl();

    const bkInfo = el('p', { class: 'prose' });
    const renderBk = () => {
      const last = Number(getLS(LS_BACKUP) || 0);
      bkInfo.textContent = 'Unterschriebene PDFs liegen nur auf diesem Gerät. Sichern Sie sie regelmäßig als ZIP, zum Beispiel in Google Drive oder iCloud. ' +
        (last ? 'Letzte Sicherung: ' + fmtDate(new Date(last)) + '.' : 'Noch keine Sicherung.');
    };
    renderBk();

    upd();
    openSheet('Einstellungen', el('div', null,
      el('p', { class: 'prose', text: 'Ihr Briefkopf steht oben auf der Seite, die Ihr Kunde zum Unterschreiben öffnet.' }),
      preview,
      el('label', { class: 'fld' }, el('span', { text: 'Name' }), name),
      el('label', { class: 'fld' }, el('span', { text: 'Zusatz (optional)' }), sub, el('small', { text: 'Steht klein unter dem Namen, zum Beispiel Ihr Beruf oder Ihr Büro.' })),
      el('h3', { text: 'Anrede' }),
      el('div', { class: 'fld' }, el('div', { class: 'segrow' }, duBtns[0], duBtns[1]),
        el('small', { text: 'Gilt für neue Anfragen. Beim Senden können Sie sie für einzelne Kunden ändern.' })),
      el('h3', { text: 'Meine Unterschrift' }),
      sigBox,
      el('h3', { text: 'Benachrichtigungen' }),
      pushBox,
      el('h3', { text: 'Kopie per E-Mail' }),
      mailBox,
      el('h3', { text: 'Felder und Vorlagen' }),
      autoRow,
      tplBox,
      el('h3', { text: 'Sicherung' }),
      bkInfo,
      el('div', { class: 'btnrow' },
        el('button', { type: 'button', class: 'btn btn-ghost', html: I.save + '<span>Jetzt sichern</span>', onclick: () => makeBackup() }),
        el('button', { type: 'button', class: 'btn btn-ghost', html: I.restore + '<span>Einspielen</span>', onclick: () => pickRestore() }))));
  }

  /* ---------------- Sicherung: alle Anfragen und unterschriebenen PDFs als ZIP ---------------- */
  const LS_BACKUP = 'firmio.backup.v1', LS_BACKUPASK = 'firmio.backupask.v1';
  // Hinweis in der Übersicht: Zahl der ungesicherten PDFs (0 = kein Hinweis)
  function backupNeeded(list) {
    if (Date.now() - Number(getLS(LS_BACKUPASK) || 0) < 7 * DAY) return 0;
    const last = Number(getLS(LS_BACKUP) || 0);
    const open = list.filter(r => r.status === 'signed' && r.local && (r.signedAt || 0) > last);
    if (!open.length) return 0;
    const oldest = Math.min.apply(null, open.map(r => r.signedAt || Date.now()));
    return open.length >= 5 || Date.now() - oldest > 7 * DAY ? open.length : 0;
  }
  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // ZIP ohne Komprimierung (PDFs sind schon komprimiert), Dateinamen in UTF-8
  function zipBlob(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    files.forEach(f => {
      const nm = enc.encode(f.name), crc = crc32(f.bytes), d = f.date || new Date();
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const date = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const lh = new Uint8Array(30 + nm.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
      v.setUint16(10, time, true); v.setUint16(12, date, true); v.setUint32(14, crc, true);
      v.setUint32(18, f.bytes.length, true); v.setUint32(22, f.bytes.length, true); v.setUint16(26, nm.length, true); v.setUint16(28, 0, true);
      lh.set(nm, 30);
      parts.push(lh, f.bytes);
      const ch = new Uint8Array(46 + nm.length), c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
      c.setUint32(20, f.bytes.length, true); c.setUint32(24, f.bytes.length, true); c.setUint16(28, nm.length, true);
      c.setUint32(42, off, true);
      ch.set(nm, 46);
      central.push(ch);
      off += lh.length + f.bytes.length;
    });
    let size = 0;
    central.forEach(x => { size += x.length; });
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }
  function unzip(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('zip');
    const n = v.getUint16(eocd + 10, true), dec = new TextDecoder();
    let p = v.getUint32(eocd + 16, true);
    const out = {};
    for (let i = 0; i < n; i++) {
      if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (lo + 30 > bytes.length || v.getUint32(lo, true) !== 0x04034b50) throw new Error('zip');
      const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
      out[name] = { method: method, raw: bytes.subarray(start, start + csize) };
    }
    return out;
  }
  async function zipEntry(e) {
    if (e.method === 0) return e.raw;
    if (e.method === 8 && window.DecompressionStream) {
      const s = new Blob([e.raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    throw new Error('zip_method');
  }
  const isoDay = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const safeFile = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
  const csvCell = v => { const s = String(v == null ? '' : v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  async function makeBackup() {
    busy('Sicherung wird erstellt …');
    let blob, count = 0, name;
    try {
      const list = (await Store.all()).sort((a, b) => (a.signedAt || a.created || 0) - (b.signedAt || b.created || 0));
      const enc = new TextEncoder(), files = [], recs = [], used = new Set();
      const rows = [['Datum', 'Status', 'Kunde', 'Notiz', 'Dokument', 'Unterschrieben von', 'Ort', 'Datei in der Sicherung']];
      for (const r of list) {
        const rec = Object.assign({}, r);
        if (r.status === 'signed' && r.local) {
          let pdf = null;
          try { pdf = await Store.pdf(r.id); } catch (e) { pdf = null; }
          if (pdf && pdf.bytes) {
            const d = new Date(r.signedAt || r.created || Date.now());
            // Neue Dateinamen haben Datum und Namen schon vorn („2026-10-11 Arben Hoxha Antrag.pdf“)
            const base = 'PDF/' + safeFile(/^\d{4}-\d\d-\d\d /.test(r.outName || '') ? r.outName.replace(/\.pdf$/i, '')
              : isoDay(d) + ' ' + [r.label || r.signer, (r.outName || r.file || 'Dokument').replace(/\.pdf$/i, '')].filter(Boolean).join(' - '));
            let fn = base + '.pdf';
            for (let i = 2; used.has(fn); i++) fn = base + ' (' + i + ').pdf';
            used.add(fn);
            files.push({ name: fn, bytes: new Uint8Array(pdf.bytes), date: d });
            rec.pdf = fn;
            count++;
          }
        }
        recs.push(rec);
        const when = r.status === 'signed' ? r.signedAt : r.created;
        rows.push([when ? fmtDate(new Date(when)) : '', r.status === 'signed' ? (r.inPerson ? 'Unterschrieben (vor Ort)' : 'Unterschrieben') : r.status === 'open' ? 'Offen' : 'Nicht unterschrieben',
          r.label || '', r.note || '', recDoc(r), signersOf(r), r.ort || '', rec.pdf || '']);
      }
      const s = loadSender();
      const data = { app: 'firmio', v: 1, created: new Date().toISOString(),
        sender: { name: s.name || '', sub: s.sub || '', du: s.du !== false, proof: s.proof !== false, viaLink: s.viaLink !== false, prefill: s.prefill !== false, mySig: loadMySig() },
        templates: loadTpls(), records: recs };
      files.unshift({ name: 'Inhaltsverzeichnis.csv', bytes: enc.encode('﻿' + rows.map(x => x.map(csvCell).join(';')).join('\r\n') + '\r\n') });
      files.unshift({ name: 'firmio-sicherung.json', bytes: enc.encode(JSON.stringify(data)) });
      blob = zipBlob(files);
      name = 'Firmio-Sicherung ' + isoDay(new Date()) + '.zip';
    } catch (e) {
      console.warn('Sicherung:', e);
      unbusy();
      toast('Die Sicherung hat nicht geklappt.');
      return;
    }
    unbusy();
    // Teilen braucht einen frischen Tipp (sonst blockiert Safari), deshalb ein eigenes Fenster
    const file = (() => { try { return new File([blob], name, { type: 'application/zip' }); } catch (e) { return null; } })();
    const canShare = !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    const done = () => {
      setLS(LS_BACKUP, String(Date.now()));
      setLS(LS_BACKUPASK, '');
      closeSheet();
      renderInbox();
    };
    const save = () => {
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: name });
      a.style.display = 'none';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      done();
      toast('Sicherung wird gespeichert.');
    };
    openSheet('Sicherung ist fertig', el('div', null,
      el('div', { class: 'filecard' }, el('span', { html: I.save }), el('div', null, el('b', { text: name }),
        el('span', { text: count + ' ' + plural(count, 'PDF', 'PDFs') + ' · ' + fmtSize(blob.size) }))),
      el('p', { class: 'prose', text: 'Legen Sie die Datei an einem sicheren Ort ab, zum Beispiel in Google Drive, iCloud oder auf dem Computer. Sie enthält die unterschriebenen PDFs, ein Inhaltsverzeichnis und Ihre Vorlagen. Mit „Einspielen“ in den Einstellungen holen Sie alles auf ein neues Handy.' }),
      canShare ? el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.share + '<span>Sichern in …</span>', onclick: async () => {
        try { await navigator.share({ files: [file] }); done(); toast('Gesichert.'); } catch (e) { if (!e || e.name !== 'AbortError') save(); }
      } }) : null,
      el('button', { type: 'button', class: 'btn btn-block ' + (canShare ? 'btn-ghost' : 'btn-primary btn-xl'), html: I.download + '<span>Herunterladen</span>', onclick: save })));
  }

  function pickRestore() {
    const input = el('input', { type: 'file', accept: '.zip,application/zip', class: 'vh' });
    document.body.append(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (f) await restoreBackup(f);
    });
    input.click();
  }
  const REC_FIELDS = { id: 's', key: 's', del: 's', secret: 's', label: 's', label2: 's', note: 's', file: 's', title: 's', parts: 'n', pages: 'n', created: 'n', expires: 'n', lang: 's', du: 'b', status: 's', link: 's',
    local: 'b', inPerson: 'b', seen: 'b', serverGone: 'b', signedAt: 'n', signer: 's', signer2: 's', ort: 's', outName: 's', outPages: 'n', size: 'n', lost: 'b', gone: 's', goneAt: 'n', remindedAt: 'n', tpl: 's',
    openedAt: 'n' };
  function cleanRecord(r) {
    if (!r || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(r.id) || ['open', 'signed', 'gone'].indexOf(r.status) < 0) return null;
    const o = {};
    Object.keys(REC_FIELDS).forEach(k => {
      const t = REC_FIELDS[k], v = r[k];
      if (t === 's' && typeof v === 'string') o[k] = v.slice(0, k === 'link' ? 300 : 200);
      else if (t === 'n' && typeof v === 'number' && isFinite(v)) o[k] = v;
      else if (t === 'b' && typeof v === 'boolean') o[k] = v;
    });
    return o;
  }
  async function restoreBackup(f) {
    busy('Sicherung wird eingelesen …');
    let added = 0, pdfs = 0;
    try {
      const z = unzip(await readFile(f));
      if (!z['firmio-sicherung.json']) throw new Error('format');
      const data = JSON.parse(new TextDecoder().decode(await zipEntry(z['firmio-sicherung.json'])));
      if (!data || data.app !== 'firmio' || !Array.isArray(data.records)) throw new Error('format');
      const have = new Map((await Store.all()).map(r => [r.id, r]));
      for (const raw of data.records) {
        const rec = cleanRecord(raw);
        if (!rec) continue;
        let bytes = null;
        if (typeof raw.pdf === 'string' && z[raw.pdf]) {
          try { bytes = await zipEntry(z[raw.pdf]); } catch (e) { bytes = null; }
          if (bytes && !looksLikePdf(bytes)) bytes = null;
        }
        const ex = have.get(rec.id);
        if (ex && !(ex.status === 'signed' && !ex.local && bytes)) continue; // schon da
        if (rec.status === 'signed' && rec.local && !bytes) { rec.local = false; rec.lost = true; }
        if (bytes) { await Store.putPdf(rec.id, bytes); rec.local = true; rec.lost = false; rec.serverGone = true; pdfs++; }
        await Store.put(ex ? Object.assign(ex, rec) : rec);
        added++;
      }
      if (Array.isArray(data.templates)) {
        const list = loadTpls();
        data.templates.forEach(t => {
          if (t && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.spots) && Array.isArray(t.sizes) && typeof t.pages === 'number' && !list.some(x => x.id === t.id)) list.push(t);
        });
        saveTpls(list.slice(0, 40));
      }
      const s = loadSender();
      if (data.sender && !s.name && typeof data.sender.name === 'string') {
        saveSender(Object.assign(s, { name: data.sender.name.slice(0, 60), sub: String(data.sender.sub || '').slice(0, 60), du: data.sender.du !== false }));
      }
      if (data.sender && sigOk(data.sender.mySig) && !loadMySig()) {
        const m = data.sender.mySig;
        saveMySig({ path: m.path, bw: m.bw, bh: m.bh, sw: m.sw, created: Number(m.created) || Date.now() });
      }
      askPersist();
    } catch (e) {
      console.warn('Einspielen:', e);
      unbusy();
      alert(e && e.message === 'zip_method' ? 'Diese ZIP-Datei ist gepackt und kann in diesem Browser nicht gelesen werden. Bitte die Original-Sicherung von Firmio wählen.'
        : 'Diese Datei ist keine Firmio-Sicherung oder sie ist beschädigt.');
      return;
    }
    unbusy();
    closeSheet();
    renderLetterhead();
    await loadInbox();
    renderInbox();
    toast(added ? added + ' ' + plural(added, 'Eintrag', 'Einträge') + ' wiederhergestellt' + (pdfs ? ', davon ' + pdfs + ' ' + plural(pdfs, 'PDF', 'PDFs') : '') + '.' : 'Alles war schon da.', 4500);
    refreshInbox();
  }

  /* ---------------- PDF erstellen ---------------- */
  // Titel aus einem Dateinamen: „Antrag_Hausrat_unterschrieben.pdf“ → „Antrag Hausrat“
  function docTitleOf(name) {
    return String(name || '').replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/(^|[\s-])unterschrieben$/i, '').trim() || 'Dokument';
  }
  // Titel des Dokuments beim Kunden (vom Absender gesetzt, sonst aus dem Dateinamen)
  const signTitle = () => (S.req && S.req.ti) || docTitleOf(S.file ? S.file.name : '');
  // Namen für den Dateinamen: „Arben Hoxha“ und „Drita Hoxha“ → „Arben & Drita Hoxha“
  function signerPart(a, b) {
    a = cleanLabel(a); b = cleanLabel(b);
    if (!a || !b) return a || b;
    const pa = a.split(' '), pb = b.split(' ');
    if (pa.length > 1 && pb.length > 1 && fold(pa[pa.length - 1]) === fold(pb[pb.length - 1])) return pa.slice(0, -1).join(' ') + ' & ' + b;
    return a + ' & ' + b;
  }
  // Dateiname des unterschriebenen PDFs: „2026-10-11 Arben Hoxha Antrag Hausrat.pdf“
  // (Wörter aus dem Namen, die schon im Titel stehen, kommen nicht doppelt vor)
  function signedName(title, a, b, d) {
    const who = signerPart(a, b);
    const key = w => fold(w).replace(/[^a-z0-9]/g, '');
    const skip = new Set(who.split(/\s+/).map(key).filter(w => w.length > 2));
    let t = cleanLabel(title);
    const rest = t.split(' ').filter(w => !skip.has(key(w)));
    if (rest.length) t = rest.join(' ');
    return safeFile([isoDay(d || new Date()), who, t].filter(Boolean).join(' ')) + '.pdf';
  }

  async function finish() {
    const sigs = S.items.filter(i => i.type === 'sig');
    if (!sigs.length) { toast(tr('Bitte zuerst unterschreiben.')); return; }
    const open = S.spots.filter(s => !s.fill);
    if (open.length && !confirm(open.length === 1 ? tr('Eine markierte Stelle ist noch leer. Trotzdem fertigstellen?') : tr('{n} markierte Stellen sind noch leer. Trotzdem fertigstellen?', { n: open.length }))) {
      scrollToObj(open[0]);
      return;
    }
    select(null);
    busy(tr('PDF wird erstellt …'));
    try {
      S.out = await buildSignedPdf();
      S.dirty = true;
      if (S.local) { await saveLocal(); return; }
      if (backMode()) { await sendBack(); return; }
      unbusy();
      showDone();
    } catch (e) {
      console.error(e);
      unbusy();
      alert(tr('Das PDF konnte nicht erstellt werden. Bitte versuchen Sie es noch einmal.') + '\n\n(' + (e && e.message ? e.message : e) + ')');
    }
  }

  // Kunde: unterschriebenes PDF verschlüsselt für den Absender bereitlegen
  async function sendBack() {
    const r = S.remote, id = encodeURIComponent(r.id);
    busy(tr('Wird verschlüsselt gesendet …'));
    try {
      const head = { name: S.out.name, title: signTitle(), signer: S.name, ort: S.ort, signedAt: new Date().toISOString(), pages: S.out.pages, match: S.hashMatch };
      if (S.sig2 && S.name2) head.signer2 = S.name2;
      const payload = await sealDoc(S.out.bytes, head, b64urlToBytes(S.req.k));
      const CH = 3 * 1024 * 1024, chunks = Math.ceil(payload.length / CH);
      await apiRetry('POST', '/api/doc/' + id + '/signed', { del: r.del, json: { size: payload.length, chunks: chunks } });
      for (let i = 0; i < chunks; i++) {
        await apiRetry('PUT', '/api/doc/' + id + '/signed/' + i, { del: r.del, body: new Blob([payload.slice(i * CH, (i + 1) * CH)]) });
        busy(tr('Wird verschlüsselt gesendet … {p} %', { p: Math.round((i + 1) / chunks * 100) }));
      }
      const res = await (await apiRetry('POST', '/api/doc/' + id + '/signed/done', { del: r.del, json: {} })).json();
      S.sentBack = { ok: true, at: res.signedAt || Date.now() };
      S.remoteSigned = { signedAt: S.sentBack.at };
      S.dirty = false;
      if (S.mail) await mailCopy(r);
    } catch (e) {
      console.warn('Zurücksenden:', e);
      S.sentBack = { ok: false, code: (e && e.code) || 'error' };
    }
    unbusy();
    showDone();
  }

  // Kunde: Kopie per E-Mail an den Absender (nur wenn er sie eingeschaltet hat). Klappt das nicht,
  // schickt das Handy des Absenders sie beim nächsten Abgleich. Höchstens ~20 s warten.
  async function mailCopy(r) {
    const big = S.out.bytes.length > MAIL_MAX;
    const body = { name: S.out.name, title: signTitle(), signer: S.name, signer2: S.sig2 ? S.name2 : '', ort: S.ort, size: S.out.bytes.length };
    if (big) body.big = true; else body.pdf = bytesToB64(S.out.bytes);
    const send = apiRetry('POST', '/api/doc/' + encodeURIComponent(r.id) + '/mail', { del: r.del, json: body }, 2)
      .catch(e => console.warn('Kopie per E-Mail:', e));
    await Promise.race([send, new Promise(res => setTimeout(res, 20000))]);
  }

  function inv(m) {
    const d = m[0] * m[3] - m[1] * m[2];
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
  }
  function thenM(f, t) {
    return [t[0] * f[0] + t[2] * f[1], t[1] * f[0] + t[3] * f[1], t[0] * f[2] + t[2] * f[3], t[1] * f[2] + t[3] * f[3],
      t[0] * f[4] + t[2] * f[5] + t[4], t[1] * f[4] + t[3] * f[5] + t[5]];
  }
  // Koordinaten "wie angezeigt" (y nach oben, Ursprung unten links) -> PDF-Nutzerraum der Seite
  function virtualToUser(pg) { return thenM([1, 0, 0, -1, 0, pg.H], inv(pg.T)); }

  const TRANS = { 'ı': 'i', 'İ': 'I', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ə': 'e', 'Ə': 'E', 'ħ': 'h', 'Ħ': 'H', 'ŧ': 't', 'Ŧ': 'T', 'ŋ': 'ng', '→': '->', '✓': 'OK', ' ': ' ', ' ': ' ', ' ': ' ' };
  function toWinAnsi(str, cs) {
    let out = '';
    for (const ch of String(str)) {
      const cp = ch.codePointAt(0);
      if (cs.has(cp)) { out += ch; continue; }
      if (TRANS[ch]) { out += TRANS[ch]; continue; }
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (base && Array.from(base).every(c => cs.has(c.codePointAt(0)))) { out += base; continue; }
      out += /\s/.test(ch) ? ' ' : '?';
    }
    return out;
  }

  function wrapText(text, font, size, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(w => {
      const t = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(t, size) <= maxW) { line = t; return; }
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(w, size) <= maxW) { line = w; return; }
      let chunk = '';
      Array.from(w).forEach(ch => {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxW && chunk) { lines.push(chunk); chunk = ch; } else chunk += ch;
      });
      line = chunk;
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function tzLabel(d) {
    const off = -d.getTimezoneOffset(), a = Math.abs(off);
    const utc = 'UTC' + (off >= 0 ? '+' : '-') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
    let name = '';
    try {
      const p = new Intl.DateTimeFormat('de-DE', { timeZoneName: 'short' }).formatToParts(d).filter(x => x.type === 'timeZoneName')[0];
      name = p ? p.value : '';
    } catch (e) { /* egal */ }
    return name && !/^(GMT|UTC)/.test(name) ? name + ', ' + utc : utc;
  }

  function deviceLabel() {
    const os = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
      : /iPhone|iPod/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'unbekannt';
    const br = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /EdgA?\/|EdgiOS/.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera'
      : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
    return os + ' · ' + br;
  }

  function placementText(who) {
    const per = {};
    S.items.forEach(i => { if (i.type === 'sig' && (who === undefined || (i.who || 0) === who)) per[i.page + 1] = (per[i.page + 1] || 0) + 1; });
    return Object.keys(per).map(Number).sort((a, b) => a - b).map(p => 'Seite ' + p + (per[p] > 1 ? ' (' + per[p] + '×)' : '')).join(', ');
  }
  // Wer hat unterschrieben (für Nachweisseite): [{ who, name, sig }]
  const signersNow = () => [0, 1].filter(w => sigOf(w) && S.items.some(i => i.type === 'sig' && (i.who || 0) === w)).map(w => ({ who: w, name: nameOf(w), sig: sigOf(w) }));

  async function rasterize(L) {
    const out = await L.PDFDocument.create();
    await rasterInto(L, out, S.pdf);
    busy(tr('PDF wird erstellt …'));
    return out;
  }
  // Seiten eines PDFs als Bilder in ein neues PDF übernehmen (für geschützte PDFs)
  async function rasterInto(L, out, pdf) {
    for (let i = 0; i < pdf.numPages; i++) {
      busy(tr('Seite {a} von {b} wird übernommen …', { a: i + 1, b: pdf.numPages }));
      const page = await pdf.getPage(i + 1);
      const v1 = page.getViewport({ scale: 1 }), pg = { W: v1.width, H: v1.height };
      const scale = Math.min(2.2, Math.sqrt(8e6 / (pg.W * pg.H)));
      const vp = page.getViewport({ scale: scale });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      try { page.cleanup(); } catch (e) { /* egal */ }
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Seite ' + (i + 1) + ' konnte nicht übernommen werden');
      const img = await out.embedJpg(await blobBytes(blob));
      c.width = c.height = 0;
      const p = out.addPage([pg.W, pg.H]);
      p.drawImage(img, { x: 0, y: 0, width: pg.W, height: pg.H });
    }
  }

  async function buildSignedPdf() {
    const L = await loadPdfLib();
    try {
      return await buildPdf(L, false);
    } catch (e) {
      console.warn('Original kann nicht direkt bearbeitet werden, wird als Bild übernommen:', e && e.message ? e.message : e);
      return await buildPdf(L, true);
    }
  }

  async function buildPdf(L, raster) {
    const now = new Date();
    let doc;
    if (raster) doc = await rasterize(L);
    else {
      doc = await L.PDFDocument.load(S.file.bytes, { updateMetadata: false });
      if (doc.isEncrypted) throw new Error('verschlüsselt');
      if (doc.getPageCount() !== S.pages.length) throw new Error('Seitenzahl weicht ab');
    }
    const F = {
      reg: await doc.embedFont(L.StandardFonts.Helvetica),
      bold: await doc.embedFont(L.StandardFonts.HelveticaBold),
      mono: await doc.embedFont(L.StandardFonts.Courier)
    };
    const cs = new Set(F.reg.getCharacterSet());
    const safe = s => toWinAnsi(s, cs);
    const ink = L.rgb(INK[0] / 255, INK[1] / 255, INK[2] / 255);
    const capColor = L.rgb(CAP[0] / 255, CAP[1] / 255, CAP[2] / 255);
    const capText = [safe(caption(now, 0)), safe(caption(now, 1))];
    const pages = doc.getPages();
    S.items.forEach(it => {
      const pg = S.pages[it.page], page = pages[it.page];
      if (!pg || !page) return;
      const who = it.who === 1 ? 1 : 0, sg = sigOf(who);
      if (it.type === 'sig' && !sg) return;
      const M = raster ? [1, 0, 0, 1, 0, 0] : virtualToUser(pg);
      page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(M[0], M[1], M[2], M[3], M[4], M[5]), L.setLineJoin(L.LineJoinStyle.Round));
      if (it.type === 'sig') {
        const c = capSize(it.w, who);
        page.drawSvgPath(sg.path, { x: it.x, y: pg.H - (it.y + c * 1.6), scale: it.w / sg.bw, borderColor: ink, borderWidth: sg.sw, borderLineCap: L.LineCapStyle.Round });
        page.drawText(capText[who], { x: it.x, y: pg.H - (it.y + c * 1.1), size: c, font: F.reg, color: capColor });
      } else {
        page.drawText(safe(it.text), { x: it.x, y: pg.H - (it.y + it.size * 0.97), size: it.size, font: F.reg, color: L.rgb(0.07, 0.07, 0.07) });
      }
      page.pushOperators(L.popGraphicsState());
    });
    const proof = S.req ? S.req.n !== 0 : true;
    if (proof) drawProof(L, doc, F, safe, ink, now, raster);
    try {
      doc.setModificationDate(now);
      doc.setProducer('Firmio (pdf-lib)');
    } catch (e) { /* egal */ }
    const bytes = await doc.save({ useObjectStreams: false });
    return { bytes: bytes, name: signedName(signTitle(), S.name, S.name2, now), pages: doc.getPageCount() };
  }

  function drawProof(L, doc, F, safe, ink, now, raster) {
    const W = 595.28, H = 841.89;
    const page = doc.addPage([W, H]);
    const X = 56, V = 200, R = W - 56;
    const cText = L.rgb(0.06, 0.1, 0.12), cMuted = L.rgb(0.36, 0.42, 0.44), cLine = L.rgb(0.86, 0.89, 0.9), cBrand = L.rgb(13 / 255, 97 / 255, 88 / 255);
    page.drawRectangle({ x: 0, y: H - 9, width: W, height: 9, color: cBrand });
    let y = H - 72;
    page.drawText(safe('Nachweis der elektronischen Unterschrift'), { x: X, y: y, size: 18, font: F.bold, color: cText });
    y -= 19;
    page.drawText(safe('Diese Seite wurde beim Unterschreiben automatisch erstellt und gehört zum Dokument.'), { x: X, y: y, size: 9.5, font: F.reg, color: cMuted });
    y -= 20;
    page.drawLine({ start: { x: X, y: y }, end: { x: R, y: y }, thickness: 0.8, color: cLine });
    y -= 26;
    const row = (label, value, o) => {
      o = o || {};
      const font = o.mono ? F.mono : o.bold ? F.bold : F.reg, size = o.mono ? 8.6 : 10.5, lh = size + 4.4;
      const lines = o.lines || wrapText(safe(value), font, size, R - V);
      page.drawText(safe(label), { x: X, y: y, size: 9, font: F.bold, color: cMuted });
      lines.forEach((ln, i) => page.drawText(ln, { x: V, y: y - i * lh, size: size, font: font, color: cText }));
      y -= lines.length * lh + 11;
    };
    const n = S.pages.length;
    row('Dokument', signTitle());
    if (S.req && S.req.q && S.req.q.length > 1) row('Enthält', S.req.q.map(x => x[0] + ' (' + x[1] + ' ' + plural(x[1], 'Seite', 'Seiten') + ')').join(', '));
    row('Umfang', n + ' ' + plural(n, 'Seite', 'Seiten') + ' Original, dazu diese Nachweisseite');
    if (S.file.hash) row('Prüfsumme (SHA-256)', '', { mono: true, lines: [S.file.hash.slice(0, 32), S.file.hash.slice(32)] });
    if (S.req) {
      if (S.req.f) row('Angefordert von', S.req.f);
      row('Abgleich mit Anfrage', S.hashMatch === true
        ? 'Stimmt überein: Es wurde genau das angeforderte Dokument unterschrieben.'
        : S.hashMatch === false ? 'Abweichend: Das unterschriebene PDF ist nicht identisch mit dem angeforderten Dokument.' : 'Nicht prüfbar.');
    }
    const who = signersNow(), many = who.length > 1;
    row('Unterzeichnet von', who.map(x => x.name).join(' und ') || S.name, { bold: true });
    if (S.ort) row('Ort', S.ort);
    row('Zeitpunkt', fmtDate(now) + ', ' + fmtTime(now, true) + ' Uhr (' + tzLabel(now) + ')');
    if (many) who.forEach(x => row('Unterschrift ' + x.name, placementText(x.who)));
    else row('Unterschrift auf', placementText());
    if (S.fileIsRemote) row('Übermittlung', backMode() ? 'Ende-zu-Ende verschlüsselt per Link erhalten und zurückgegeben' : 'Per Ende-zu-Ende-verschlüsseltem Link erhalten');
    else if (S.local) row('Übermittlung', 'Vor Ort auf dem Gerät des Absenders unterschrieben');
    row('Gerät', deviceLabel());
    // Unterschrift(en): bei zwei Personen beide, mit Namen darunter
    (who.length ? who : [{ name: S.name, sig: S.sig }]).forEach((x, k) => {
      if (k) y -= 6;
      page.drawText(safe(many ? 'Unterschrift ' + (k + 1) : 'Unterschrift'), { x: X, y: y, size: 9, font: F.bold, color: cMuted });
      const sc = Math.min(230 / x.sig.bw, (many ? 56 : 72) / x.sig.bh);
      const top = y + 9;
      page.pushOperators(L.pushGraphicsState(), L.setLineJoin(L.LineJoinStyle.Round));
      page.drawSvgPath(x.sig.path, { x: V, y: top, scale: sc, borderColor: ink, borderWidth: x.sig.sw, borderLineCap: L.LineCapStyle.Round });
      page.pushOperators(L.popGraphicsState());
      y = top - x.sig.bh * sc - 5;
      page.drawLine({ start: { x: V, y: y }, end: { x: V + 230, y: y }, thickness: 0.6, color: cLine });
      if (many) { page.drawText(safe(x.name), { x: V, y: y - 11, size: 8.6, font: F.reg, color: cMuted }); y -= 14; }
      y -= many ? 22 : 34;
    });
    if (many) y -= 12;
    const para = 'Art der Unterschrift: einfache elektronische Signatur. Die Unterschrift wurde mit dem Finger auf dem Touchscreen gezeichnet und im Browser des Unterzeichners in das Dokument eingesetzt. ' +
      (backMode() ? 'Das Originaldokument kam Ende-zu-Ende-verschlüsselt per Link; das unterschriebene Dokument geht auf demselben Weg verschlüsselt an den Absender zurück. '
        : S.fileIsRemote ? 'Das Originaldokument kam Ende-zu-Ende-verschlüsselt per Link; das unterschriebene Dokument wurde nicht hochgeladen. ' : 'Das Dokument wurde dabei nicht hochgeladen. ') +
      'Die Prüfsumme gehört zum Dokument vor dem Unterschreiben. Mit ihr lässt sich prüfen, ob genau dieses Dokument unterschrieben wurde. Die Zeitangabe stammt von der Uhr des verwendeten Geräts.' +
      (raster ? ' Das Originaldokument war gegen Änderungen geschützt und wurde deshalb als Bild übernommen.' : '');
    wrapText(safe(para), F.reg, 8.8, R - X).forEach(ln => {
      page.drawText(ln, { x: X, y: y, size: 8.8, font: F.reg, color: cMuted });
      y -= 12.6;
    });
    page.drawText(safe('Erstellt mit Firmio' + (location.host ? ' (' + location.host + ')' : '') + ' · ' + fmtDate(now)), { x: X, y: 40, size: 8, font: F.reg, color: cMuted });
  }

  /* ---------------- Fertig ---------------- */
  function outFile() { return new File([S.out.bytes], S.out.name, { type: 'application/pdf' }); }

  function showDone() {
    showScreen('done');
    window.scrollTo(0, 0);
    $('#outName').textContent = S.out.name;
    $('#outInfo').textContent = (S.out.pages === 1 ? tr('1 Seite') : tr('{n} Seiten', { n: S.out.pages })) + ' · ' + fmtSize(S.out.bytes.length);
    let can = false;
    try { can = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [outFile()] })); } catch (e) { can = false; }
    const who = S.req && S.req.f;
    const sb = backMode() ? S.sentBack : null;
    const mark = $('#doneMark') || $('#done .okmark'), retry = $('#retryBtn') || el('button'), share = $('#shareBtn'), dl = $('#dlBtn');
    if (mark) {
      mark.classList.toggle('bad', !!(sb && !sb.ok));
      mark.innerHTML = sb && !sb.ok ? I.warnL : I.checkL;
    }
    $('#editBtn').classList.toggle('hidden', !!(sb && sb.ok));
    $('#newBtn').classList.toggle('hidden', !!sb);
    retry.classList.add('hidden');
    $('#dlLabel').textContent = tr('PDF speichern');
    const over = $('#overBtn');
    over.classList.add('hidden');
    if (S.local) {
      // Vor Ort: Das PDF liegt schon in der Übersicht. Der Kunde gibt das Handy zurück.
      const ok = !!S.local.saved;
      if (mark) { mark.classList.toggle('bad', !ok); mark.innerHTML = ok ? I.checkL : I.warnL; }
      $('#doneTitle').textContent = tr('Fertig!');
      $('#doneLead').textContent = ok ? tr('Danke! Sie können das Handy jetzt zurückgeben.')
        : 'Das PDF konnte nicht in der Übersicht gespeichert werden. Bitte jetzt speichern oder teilen.';
      over.classList.toggle('hidden', !ok);
      $('#shareLabel').textContent = 'PDF teilen';
      share.className = 'btn btn-block btn-ghost' + (ok || !can ? ' hidden' : '');
      dl.className = 'btn btn-block ' + (ok ? 'btn-ghost hidden' : 'btn-primary btn-xl');
      $('#editBtn').classList.add('hidden');
      $('#newBtn').classList.add('hidden');
      $('#shareHint').textContent = '';
      return;
    }
    if (sb && sb.ok) {
      // Erledigt: Das PDF ist schon beim Absender
      $('#doneTitle').textContent = tr('Erledigt!');
      $('#doneLead').textContent = who ? tr('Ihr unterschriebenes Dokument ist bei {who} angekommen. Sie müssen nichts mehr tun.', { who: who })
        : tr('Ihr unterschriebenes Dokument ist beim Absender angekommen. Sie müssen nichts mehr tun.');
      share.classList.add('hidden');
      $('#shareHint').textContent = tr('Sie können die Seite jetzt schließen.');
      dl.className = 'btn btn-block btn-ghost';
      $('#dlLabel').textContent = tr('Kopie für mich speichern');
      return;
    }
    if (sb) {
      // Senden hat nicht geklappt: noch einmal versuchen oder per WhatsApp
      const c = sb.code;
      const gone = c === 'not_found' || c === 'expired' || c === 'http_404' || c === 'http_410';
      const big = c === 'too_large' || c === 'http_413';
      const taken = c === 'signed' || c === 'http_409' || c === 'forbidden';
      $('#doneTitle').textContent = tr('Noch nicht gesendet');
      $('#doneLead').textContent = gone ? tr('Der Link ist abgelaufen. Bitte schicken Sie das PDF per WhatsApp zurück.')
        : taken ? tr('Für diesen Link wurde schon ein unterschriebenes Dokument übermittelt. Möchten Sie etwas ändern, schicken Sie das PDF bitte per WhatsApp.')
          : big ? tr('Das Dokument ist zu groß zum Senden. Bitte schicken Sie das PDF per WhatsApp zurück.')
            : tr('Das Senden hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es noch einmal.');
      const canRetry = !gone && !big && !taken;
      retry.classList.toggle('hidden', !canRetry);
      share.classList.toggle('hidden', !can);
      share.className = 'btn btn-block ' + (canRetry ? 'btn-ghost' : 'btn-primary btn-xl') + (can ? '' : ' hidden');
      dl.className = 'btn btn-block btn-ghost';
      $('#shareHint').textContent = '';
      return;
    }
    $('#doneTitle').textContent = tr('Fertig unterschrieben');
    share.className = 'btn btn-primary btn-block btn-xl' + (can ? '' : ' hidden');
    dl.className = 'btn btn-block ' + (can ? 'btn-ghost' : 'btn-primary btn-xl');
    $('#doneLead').textContent = who ? tr('Schicken Sie das PDF jetzt an {who} zurück, am einfachsten per WhatsApp.', { who: who }) : tr('Schicken Sie das PDF jetzt zurück, am einfachsten per WhatsApp.');
    $('#shareHint').textContent = can
      ? (who ? tr('Im nächsten Schritt WhatsApp wählen und dann den Chat mit {who}.', { who: who }) : tr('Im nächsten Schritt WhatsApp wählen und dann den Chat, aus dem Sie das Dokument bekommen haben.'))
      : tr('Speichern Sie das PDF und hängen Sie es in WhatsApp über die Büroklammer als „Dokument“ an.');
  }

  async function shareResult() {
    try {
      await navigator.share({ files: [outFile()] });
      S.dirty = false;
      deleteRemote(); // nur im alten Ablauf ohne Rückgabe
      toast(tr('Danke! Sie können die Seite jetzt schließen.'), 4000);
    } catch (e) {
      if (!e || e.name !== 'AbortError') toast(tr('Teilen hat nicht geklappt. Bitte „PDF speichern“ nutzen.'), 4500);
    }
  }

  function toStart() {
    closeSheet(true);
    S.inViewer = false;
    S.items = []; S.spots = []; S.sel = null; S.out = null; S.dirty = false; S.sig = null;
    S.pages.forEach(p => { if (p.url) URL.revokeObjectURL(p.url); });
    S.pages = [];
    if (io) io.disconnect();
    $('#pages').innerHTML = '';
    $('#bar').innerHTML = '';
    if (S.pdf) { try { S.pdf.destroy(); } catch (e) { /* egal */ } }
    S.pdf = null;
    S.file = null;
    S.fileIsRemote = false;
    S.view = null;
    S.intent = 'link';
    if (S.local) endLocal();
    showScreen('start');
    if (S.mode === 'send') { renderLetterhead(); loadInbox().then(renderInbox); refreshInbox(); reloadIfIdle(); }
    if (S.remoteSigned) renderRemoteSigned();
    else if (S.remote) renderRemoteReady();
    window.scrollTo(0, 0);
  }

  function onPop() {
    if (S.sheetOpen) { closeSheet(); history.pushState({ unterschrift: 1 }, ''); return; }
    if (!S.inViewer) return;
    if (S.dirty && !confirm(S.mode === 'send' ? 'Dokument schließen? Die markierten Felder gehen dabei verloren.' : tr('Dokument schließen? Ihre Unterschrift geht dabei verloren.'))) {
      history.pushState({ unterschrift: 1 }, '');
      return;
    }
    toStart();
  }

  /* ---------------- Sheet, Toast, Warten ---------------- */
  let sheetOnClose = null;
  function openSheet(title, body, opts) {
    const sh = $('#sheet'), sc = $('#scrim');
    if (S.sheetOpen) closeSheet(true);
    $('#toast').classList.remove('on');
    sh.innerHTML = '';
    sh.append(el('div', { class: 'grab' }),
      el('div', { class: 'sh' }, el('h2', { id: 'sheetTitle', text: title }),
        el('button', { type: 'button', class: 'close', 'aria-label': tr('Schließen'), html: I.x, onclick: () => closeSheet() })),
      body);
    sh.hidden = false;
    sc.hidden = false;
    sh.scrollTop = 0;
    S.sheetOpen = true;
    sheetOnClose = opts && opts.onClose || null;
    requestAnimationFrame(() => requestAnimationFrame(() => { sh.classList.add('on'); sc.classList.add('on'); }));
  }
  function closeSheet(instant) {
    if (!S.sheetOpen) return;
    const sh = $('#sheet'), sc = $('#scrim');
    S.sheetOpen = false;
    const cb = sheetOnClose;
    sheetOnClose = null;
    if (cb) { try { cb(); } catch (e) { console.warn(e); } }
    if (document.activeElement && sh.contains(document.activeElement)) document.activeElement.blur();
    sh.classList.remove('on');
    sc.classList.remove('on');
    const hide = () => { if (!S.sheetOpen) { sh.hidden = true; sc.hidden = true; sh.innerHTML = ''; } };
    if (instant) hide(); else setTimeout(hide, 300);
  }

  let toastT = 0;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), ms || 2800);
  }
  function busy(msg) { $('#busyText').textContent = msg || tr('Einen Moment …'); $('#busy').hidden = false; }
  function unbusy() { $('#busy').hidden = true; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
