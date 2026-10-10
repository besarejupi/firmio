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
    "Das Dokument ist im Link enthalten.": "Dokumenti ndodhet në link.",
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
    "<p><b>Dokumente per Link:</b> Das Dokument wurde auf dem Gerät des Absenders verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Wenn Sie auf „Fertig“ tippen, wird das unterschriebene Dokument auf Ihrem Gerät mit diesem Schlüssel verschlüsselt und für den Absender bereitgelegt. Danach wird das Original gelöscht. Das unterschriebene Dokument wird gelöscht, sobald der Absender es abgeholt hat, spätestens nach 30 Tagen. Nicht unterschriebene Dokumente werden nach 7 Tagen gelöscht.</p>": "<p><b>Dokumente me link:</b> Dokumenti është enkriptuar në pajisjen e dërguesit dhe ruhet te Netlify vetëm i enkriptuar. Çelësi ndodhet vetëm në link (pas shenjës #) dhe nuk i dërgohet kurrë serverit. Kur prekni „Gati“, dokumenti i nënshkruar enkriptohet në pajisjen tuaj me këtë çelës dhe i vihet në dispozicion dërguesit. Pastaj origjinali fshihet. Dokumenti i nënshkruar fshihet sapo dërguesi ta ketë marrë, e më së voni pas 30 ditësh. Dokumentet e panënshkruara fshihen pas 7 ditësh.</p>"
  };
  // Übersetzung der Kundenseite (Deutsch = Schlüssel). Fehlt eine Übersetzung, bleibt es Deutsch.
  function tr(str, vars) {
    let out = S.lang === 'sq' && SQ[str] ? SQ[str] : str;
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
    chev: svgI('<path d="M9 6l6 6-6 6"/>', 18, 2.2),
    doc: svgI('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5c1.2-1.6 2-2.9 2.6-2.6.6.3-.6 2.4 0 2.5.7.1 1.3-1.4 1.9-1.3.5.1 0 1.2.6 1.2.7 0 1.2-.6 1.9-.8"/>', 30, 1.8)
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
    sendLang: 'de',     // Absender: gewählte Sprache für den Kunden
    server: null,       // Absender: { ok, pin, v } – gibt es den Server-Teil?
    sent: null,         // Absender: hochgeladenes Dokument { id, del, key, expires, track }
    sentBack: null,     // Kunde: Ergebnis der Rückgabe { ok, code, at }
    remoteSigned: null, // Kunde: Link wurde schon unterschrieben zurückgegeben { signedAt }
    view: null,         // Absender: angezeigtes unterschriebenes PDF (ID aus der Übersicht)
    inbox: { list: [], ok: true, err: '', last: 0, filter: 'all' }
  };
  const LS_PIN = 'firmio.pin.v1';
  const LS_FILTER = 'firmio.filter.v1';
  const DAY = 864e5;
  const LINK_PLACEHOLDER = '[Der Link wird beim Erstellen eingefügt]';
  let padMem = null;
  let io = null;
  let renderQueue = Promise.resolve();
  let installEvt = null;

  /* ---------------- Start ---------------- */
  function init() {
    const h = location.hash || '';
    if (/^#absender\b/i.test(h)) S.mode = 'send';
    S.req = S.mode === 'sign' ? parseReq(h) : null;
    S.lang = S.req && S.req.l === 'sq' ? 'sq' : 'de';
    applyStatic();
    setupStart();

    $('#file').addEventListener('change', onFile);
    $('#backBtn').addEventListener('click', () => history.back());
    $('#scrim').addEventListener('click', () => closeSheet());
    $('#shareBtn').addEventListener('click', shareResult);
    $('#retryBtn').addEventListener('click', () => { if (S.out && backMode()) sendBack(); });
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
    if (S.req && S.req.d && S.req.k) loadRemote();
    if (S.mode === 'send') initInbox();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && S.mode === 'send' && !S.inViewer) refreshInbox();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSheet();
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel && !S.sheetOpen && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); removeObj(S.sel);
      }
    });
  }

  function parseReq(h) {
    const m = /(?:^#|&)r=([A-Za-z0-9_-]+)/.exec(h);
    if (!m) return null;
    try {
      const o = JSON.parse(fromB64url(m[1]));
      if (!o || o.v !== 1) return null;
      const s = Array.isArray(o.s) ? o.s.filter(a => Array.isArray(a) && a.length === 6 && (a[0] === 's' || a[0] === 'd') &&
        a.slice(1).every(v => typeof v === 'number' && isFinite(v) && v >= 0)).slice(0, 40) : [];
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
        b: o.b === 1 ? 1 : 0
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
    $('#retryLabel').textContent = tr('Erneut senden');
    $('#viewer').setAttribute('aria-label', tr('Dokument'));
  }

  function setLang(l) {
    S.lang = l === 'sq' ? 'sq' : 'de';
    applyStatic();
    setupStart();
    if (S.remoteSigned) renderRemoteSigned();
    else if (S.remote) renderRemoteReady();
  }

  function setupStart() {
    const send = S.mode === 'send';
    $('#brandSub').textContent = tr('Dokumente sicher unterschreiben');
    if (CFG.anbieter) { $('#brandName').textContent = CFG.anbieter; $('#brandSub').textContent = tr('mit Firmio sicher unterschreiben'); }
    document.title = (send ? 'Unterschrift anfordern' : tr('Dokument unterschreiben')) + ' · Firmio';
    $('#startTitle').textContent = send ? 'Unterschrift anfordern' : tr('Dokument unterschreiben');
    const inLink = !!(S.req && S.req.d && S.req.k);
    $('#startLead').textContent = send
      ? 'Markieren Sie, wo unterschrieben werden soll, und schicken Sie den Link per WhatsApp. Das unterschriebene PDF landet automatisch hier.'
      : inLink ? tr('Ihr Dokument steckt schon im Link. Sie müssen nichts speichern und nichts herunterladen.')
        : tr('Unterschreiben Sie ein PDF direkt auf Ihrem Handy, ganz ohne Drucker.');
    const back = linkBack(), whoNom = S.req && S.req.f;
    $('#trustText').textContent = send
      ? 'Ende-zu-Ende verschlüsselt. Unterschriebene Dokumente werden nur auf diesem Gerät gespeichert.'
      : back ? (whoNom ? tr('Ende-zu-Ende verschlüsselt. Nur Sie und {who} können das Dokument lesen.', { who: whoNom }) : tr('Ende-zu-Ende verschlüsselt. Nur Sie und der Absender können das Dokument lesen.'))
        : inLink ? tr('Ende-zu-Ende verschlüsselt. Ihre Unterschrift wird nicht hochgeladen, und das Dokument wird nach dem Zurückschicken gelöscht.')
          : tr('Ihr Dokument bleibt auf Ihrem Gerät. Es wird nichts hochgeladen und nichts gespeichert.');

    const nSig = S.req ? S.req.s.filter(a => a[0] === 's').length : 0;
    const steps = send ? [
      ['PDF auswählen', 'Das Dokument, das Ihr Kunde unterschreiben soll.'],
      ['Stellen markieren', 'Felder für Unterschrift und Ort/Datum auf das Dokument ziehen.'],
      ['Per WhatsApp senden', 'Ihr Kunde unterschreibt über den Link. Das PDF landet danach automatisch hier in Ihrer Übersicht.']
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

    const card = $('#reqCard');
    if (S.req) {
      const who = S.req.f;
      const initials = who ? who.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') : '';
      card.innerHTML = '';
      card.append(
        el('div', { class: 'av', html: initials ? esc(initials) : I.pen }),
        el('div', null,
          el('p', { html: who ? tr('<b>{who}</b> bittet Sie um Ihre Unterschrift.', { who: esc(who) }) : tr('Sie wurden gebeten, ein Dokument zu unterschreiben.') }),
          el('p', { text: nSig ? (nSig === 1 ? tr('Die Stelle zum Unterschreiben ist schon markiert.') : tr('{n} Stellen zum Unterschreiben sind schon markiert.', { n: nSig }))
            : inLink ? tr('Das Dokument ist im Link enthalten.') : tr('Wählen Sie unten das PDF aus, das Sie bekommen haben.') })));
      card.classList.remove('hidden');
    }

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
    const body = CFG.datenschutz
      ? el('div', { class: 'prose pre', text: CFG.datenschutz })
      : el('div', { class: 'prose', html:
        (back ? tr('<p><b>Ende-zu-Ende verschlüsselt.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Übertragen wird nur das fertige Dokument, und zwar verschlüsselt: Lesen können es nur Sie und der Absender.</p>')
          : tr('<p><b>Ihr Dokument bleibt auf Ihrem Gerät.</b> Das PDF, Ihr Name und Ihre Unterschrift werden nur in Ihrem Browser verarbeitet. Nichts davon wird hochgeladen, gespeichert oder an Dritte übermittelt.</p>')) +
        tr('<p>Diese Seite verwendet keine Cookies, kein Tracking und keine Analysedienste. Sie ist technisch so eingestellt, dass sie keine Daten an fremde Server senden kann.</p>') +
        tr('<p>Beim Aufruf der Seite verarbeitet der Hosting-Anbieter (Netlify) technisch notwendige Verbindungsdaten wie die IP-Adresse, um die Seite auszuliefern.</p>') +
        (back ? tr('<p><b>Dokumente per Link:</b> Das Dokument wurde auf dem Gerät des Absenders verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Wenn Sie auf „Fertig“ tippen, wird das unterschriebene Dokument auf Ihrem Gerät mit diesem Schlüssel verschlüsselt und für den Absender bereitgelegt. Danach wird das Original gelöscht. Das unterschriebene Dokument wird gelöscht, sobald der Absender es abgeholt hat, spätestens nach 30 Tagen. Nicht unterschriebene Dokumente werden nach 7 Tagen gelöscht.</p>')
          : tr('<p><b>Dokumente per Link:</b> Schickt Ihnen jemand ein Dokument per Link, wurde es auf seinem Gerät verschlüsselt und liegt nur verschlüsselt bei Netlify. Der Schlüssel steckt ausschließlich im Link (hinter dem #) und wird nie an den Server übertragen. Niemand außer Ihnen und dem Absender kann das Dokument lesen. Es wird gelöscht, sobald Sie es unterschrieben zurückgeschickt haben, spätestens nach 7 Tagen.</p>') +
            tr('<p>Das unterschriebene PDF verschicken Sie selbst, zum Beispiel per WhatsApp. Dafür gelten die Datenschutzbestimmungen des jeweiligen Dienstes.</p>')) +
        (S.mode === 'send' ? '<p><b>Ihre Übersicht</b> (Kundennotizen, Schlüssel und unterschriebene PDFs) wird nur auf diesem Gerät gespeichert. Unterschriebene Dokumente werden vom Server gelöscht, sobald Firmio sie abgeholt hat.</p>' : '') +
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
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let bytes;
    try { bytes = await readFile(f); } catch (err) { alert(tr('Die Datei konnte nicht gelesen werden.')); return; }
    await openBytes(bytes, f.name, false);
  }

  async function openBytes(bytes, name, fromLink) {
    busy(tr('Dokument wird geöffnet …'));
    try {
      if (!looksLikePdf(bytes)) {
        unbusy();
        alert(tr('Diese Datei ist kein PDF. Bitte wählen Sie das PDF-Dokument aus.'));
        return false;
      }
      if (!window.pdfjsLib) throw new Error('pdfjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const task = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
      task.onPassword = (update, reason) => {
        unbusy();
        const pw = prompt(reason === 2 ? tr('Falsches Passwort. Bitte noch einmal eingeben:') : tr('Das PDF ist mit einem Passwort geschützt. Bitte Passwort eingeben:'));
        if (pw === null) { task.destroy(); return; }
        busy(tr('Dokument wird geöffnet …'));
        update(pw);
      };
      const pdf = await task.promise;
      const hash = await sha256(bytes);
      if (S.pdf) { try { S.pdf.destroy(); } catch (x) { /* egal */ } }
      S.file = { name: cleanName(name), bytes: bytes, hash: hash };
      S.fileIsRemote = !!fromLink;
      S.pdf = pdf;
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

  async function uploadDoc(pin, onProgress) {
    const enc = await encryptDoc(S.file.bytes, S.file.name);
    const CH = 3 * 1024 * 1024;
    const chunks = Math.ceil(enc.payload.length / CH);
    const created = await apiJSON('POST', '/api/doc', { pin: pin, json: { size: enc.payload.length, chunks: chunks } });
    for (let i = 0; i < chunks; i++) {
      await apiFetch('PUT', '/api/doc/' + created.id + '/' + i, { pin: pin, body: new Blob([enc.payload.slice(i * CH, (i + 1) * CH)]) });
      if (onProgress) onProgress((i + 1) / chunks);
    }
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
      S.server = j && j.ok ? { ok: true, pin: !!j.pin, v: Number(j.v) || 1 } : { ok: false };
    } catch (e) { S.server = { ok: false }; }
    return S.server;
  }
  function getPin() { try { return localStorage.getItem(LS_PIN) || ''; } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(LS_PIN, v); else localStorage.removeItem(LS_PIN); } catch (e) { /* egal */ } }

  // Kunde: Dokument aus dem Link laden
  async function loadRemote() {
    const r = S.req;
    const box = $('#remoteBox');
    $('#pickBtn').classList.add('hidden');
    const fill = el('i');
    box.innerHTML = '';
    box.append(el('div', { class: 'remote' },
      el('div', { class: 'spin sm' }),
      el('div', { class: 'grow' }, el('b', { text: tr('Dokument wird geladen …') }), el('div', { class: 'prog' }, fill))));
    try {
      const meta = await apiJSON('GET', '/api/doc/' + r.d);
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
        el('b', { text: S.remote && S.remote.name ? S.remote.name : tr('Dokument') }),
        el('p', { text: at ? tr('Unterschrieben am {date} um {time} Uhr.', { date: fmtDate(at), time: fmtTime(at) }) : tr('Bereits unterschrieben') }))));
  }

  function renderRemoteReady() {
    const box = $('#remoteBox');
    box.innerHTML = '';
    $('#pickBtn').classList.add('hidden');
    box.append(el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.check + '<span>' + tr('Dokument öffnen') + '</span>',
      onclick: () => openBytes(S.remote.bytes, S.remote.name, true) }),
    el('p', { class: 'hint', text: tr('{name} · gültig bis {date}', { name: S.remote.name, date: fmtDate(new Date(S.remote.expires)) }) }));
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
      box.append(el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', text: tr('Erneut versuchen'), onclick: loadRemote }));
    }
    box.append(el('p', { class: 'hint', text: tr('Haben Sie das PDF auf dem Handy? Dann können Sie es auch selbst auswählen.') }));
    const pick = $('#pickBtn');
    pick.classList.remove('hidden');
    pick.classList.remove('btn-primary');
    pick.classList.add('btn-ghost');
    renderHelp(true);
  }

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
    S.items = []; S.spots = []; S.sel = null; S.out = null; S.dirty = false; S.hashMatch = null; S.cur = 0; S.sig = null; S.sent = null; S.sendLang = 'de'; S.sentBack = null; S.custLabel = '';
    showScreen('viewer');
    $('#docName').textContent = S.file.name;
    $('#modeChip').textContent = S.view ? 'Unterschrieben' : S.mode === 'send' ? 'Anfordern' : '';
    await buildPages();
    if (S.view) {
      // nur ansehen
    } else if (S.mode === 'send') {
      banner('info', 'Tippen Sie unten auf „Unterschrift“ und ziehen Sie das gelbe Feld auf die Unterschriftslinie. Mit dem Punkt unten rechts ändern Sie die Größe.');
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
    relayout();
    S.pages.forEach(p => { if (io) io.observe(p.wrap); else queueRender(p); });
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
    renderQueue = renderQueue.then(() => doc === S.pdf ? renderPage(pg, doc) : null).catch(err => { console.warn(err); pg.state = 0; });
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

  function banner(type, text) {
    const box = $('#bannerBox');
    if (!box) return;
    box.innerHTML = '';
    if (!text) return;
    const b = el('div', { class: 'banner' + (type === 'warn' ? ' warn' : ''), role: type === 'warn' ? 'alert' : 'note' },
      el('span', { html: type === 'warn' ? I.warn : I.info }),
      el('p', { text: text }),
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
        S.spots.push({ id: nid(), type: 'spot', k: a[0], page: pi, x: clamp(a[2], 0, pg.W - w), y: clamp(a[3], 0, pg.H - h), w: w, h: h, fill: null });
      });
      S.spots.forEach(renderSpot);
    }
    const nSig = S.spots.filter(s => s.k === 's').length;
    if (!pagesOk) {
      banner('warn', tr('Dieses PDF passt nicht zur Anfrage (andere Seitenzahl). Bitte prüfen Sie, ob Sie das richtige Dokument gewählt haben. Sie können trotzdem unterschreiben und die Unterschrift selbst platzieren.'));
    } else if (S.hashMatch === false) {
      banner('warn', tr('Dieses PDF ist nicht genau das angeforderte Dokument. Wählen Sie am besten das PDF aus der Nachricht. Sie können trotzdem unterschreiben.'));
    } else if (nSig) {
      banner('info', nSig === 1
        ? tr('Die gelb markierte Stelle wird nach dem Unterschreiben automatisch ausgefüllt.')
        : tr('Die {n} gelb markierten Stellen werden nach dem Unterschreiben automatisch ausgefüllt.', { n: nSig }));
    }
  }

  /* ---------------- Objekte auf der Seite ---------------- */
  function caption(d) {
    return (S.name ? S.name + ' · ' : '') + 'elektronisch unterschrieben · ' + fmtDate(d) + ', ' + fmtTime(d) + ' Uhr';
  }
  function capSize(w) { return clamp(w / (caption(new Date()).length * 0.5), 3.6, 6.2); }
  function capH(w) { return capSize(w) * 1.6; }
  function sigH(w) { return capH(w) + w * S.sig.bh / S.sig.bw; }
  let measureCtx = null;
  function textWidth(o) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = '100px Helvetica, Arial, sans-serif';
    return measureCtx.measureText(o.text).width / 100 * o.size;
  }
  function objW(o) { return o.type === 'text' ? textWidth(o) : o.w; }
  function objH(o) { return o.type === 'sig' ? sigH(o.w) : o.type === 'text' ? o.size * 1.25 : o.h; }

  function sigSvg(w) {
    const s = S.sig, cs = capSize(w), h = sigH(w), sc = w / s.bw;
    return '<svg viewBox="0 0 ' + r2(w) + ' ' + r2(h) + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<text x="0" y="' + r2(cs * 1.1) + '" font-size="' + r2(cs) + '" fill="' + CAP_CSS + '" font-family="Helvetica, Arial, sans-serif">' + esc(caption(new Date())) + '</text>' +
      '<g transform="translate(0 ' + r2(cs * 1.6) + ') scale(' + (Math.round(sc * 10000) / 10000) + ')">' +
      '<path d="' + s.path + '" fill="none" stroke="' + INK_CSS + '" stroke-width="' + r2(s.sw) + '" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';
  }

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
    if (o.type === 'sig') o.vis.innerHTML = sigSvg(o.w);
    else if (o.type === 'text') { o.vis.innerHTML = ''; o.vis.append(el('span', { class: 'tx', text: o.text })); }
  }

  function layoutObj(o) {
    const pg = S.pages[o.page];
    if (!pg || !o.node) return;
    const k = pg.k, n = o.node;
    n.style.left = (o.x * k) + 'px';
    n.style.top = (o.y * k) + 'px';
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
        n.append(el('span', { class: 'lbl', text: sp.k === 's' ? 'Unterschrift' : 'Ort, Datum' }), del,
          el('span', { class: 'h-rs', 'data-role': 'resize', 'aria-hidden': 'true', html: I.resize }));
        bindDrag(n, sp);
      } else {
        n.setAttribute('role', 'button');
        n.setAttribute('aria-label', sp.k === 's' ? tr('Hier unterschreiben') : tr('Ort und Datum einsetzen'));
        n.append(el('span', { class: 'tag', html: (sp.k === 's' ? I.penS + esc(tr('Hier unterschreiben')) : I.calS + esc(tr('Ort, Datum'))) }));
        n.addEventListener('click', () => onSpotTap(sp));
      }
      sp.node = n;
    }
    const pg = S.pages[sp.page];
    if (sp.node.parentNode !== pg.ov) pg.ov.prepend(sp.node);
    sp.node.classList.toggle('filled', !!sp.fill);
    layoutObj(sp);
  }

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
      if (role === 'del') return;
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
    if (o.type === 'sig') {
      let w = clamp(st.w + dx, 50, pg.W - o.x);
      let guard = 0;
      while (w > 50 && o.y + sigH(w) > pg.H && guard++ < 200) w -= 2;
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
    if (!S.sig) { openPad({ via: 'spot' }); return; }
    const it = fillSpot(sp, true);
    if (it) toast(tr('Eingesetzt. Zum Verschieben ziehen.'));
    renderBar();
  }

  function fillSpot(sp, doSelect) {
    if (sp.fill) return null;
    const pg = S.pages[sp.page];
    let it;
    if (sp.k === 's') {
      let w = Math.min(sp.w, pg.W - sp.x);
      let guard = 0;
      while (w > 40 && sigH(w) > sp.h && guard++ < 80) w *= 0.96;
      const h = sigH(w);
      it = { id: nid(), type: 'sig', page: sp.page, x: sp.x, y: clamp(sp.y + sp.h - h, 0, Math.max(0, pg.H - h)), w: w, spot: sp.id };
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

  function placeSig(pi) {
    const pg = S.pages[pi];
    const w = clamp(48 * S.sig.bw / S.sig.bh, 80, 160);
    const h = sigH(w);
    const cy = visibleCenterPt(pg);
    const it = { id: nid(), type: 'sig', page: pi, x: clamp(pg.W * 0.12, 0, Math.max(0, pg.W - w)), y: clamp(cy - h / 2, 0, Math.max(0, pg.H - h)), w: w };
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

  function adoptSignature(strokes, padW) {
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
    S.sig = { path: strokesToPath(strokes, ox, oy), bw: bw, bh: bh, sw: sw };
  }

  function openPad(opts) {
    opts = opts || {};
    const name = el('input', { class: 'in', type: 'text', autocomplete: 'name', autocapitalize: 'words', enterkeyhint: 'next', placeholder: tr('Vor- und Nachname'), value: S.name, maxlength: '80' });
    const ort = el('input', { class: 'in', type: 'text', autocomplete: 'address-level2', autocapitalize: 'words', enterkeyhint: 'done', placeholder: tr('z. B. Remscheid'), value: S.ort, maxlength: '60' });
    const pad = makePad(padMem);
    const err = el('p', { class: 'err', role: 'alert' });
    const ok = el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.check + '<span>' + tr('Übernehmen') + '</span>' });
    const hasDate = S.spots.some(s => s.k === 'd');
    const body = el('div', null,
      el('label', { class: 'fld' }, el('span', { text: tr('Ihr Name') }), name),
      el('label', { class: 'fld' }, el('span', { text: hasDate ? tr('Ort (für „Ort, Datum“)') : tr('Ort (optional)') }), ort),
      el('div', { class: 'lblrow' }, el('span', { text: tr('Ihre Unterschrift') }),
        el('button', { type: 'button', text: tr('Löschen'), onclick: () => { pad.clear(); err.textContent = ''; } })),
      pad.node,
      el('p', { class: 'legal', text: tr('Mit „Übernehmen“ bestätigen Sie, dass dies Ihre Unterschrift ist. Damit unterschreiben Sie das Dokument elektronisch.') }),
      err, ok);
    name.addEventListener('input', () => name.classList.remove('bad'));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ort.focus(); } });
    ort.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ort.blur(); } });
    ok.addEventListener('click', () => {
      const nm = name.value.replace(/\s+/g, ' ').trim();
      if (nm.length < 2) { err.textContent = tr('Bitte geben Sie Ihren Namen ein.'); name.classList.add('bad'); return; }
      if (!pad.valid()) { err.textContent = tr('Bitte unterschreiben Sie im weißen Feld.'); return; }
      const before = S.sig ? S.items.filter(i => i.type === 'sig').map(i => [i, i.y + sigH(i.w)]) : [];
      const first = !S.sig;
      S.name = nm;
      S.ort = ort.value.replace(/\s+/g, ' ').trim();
      padMem = pad.strokes();
      adoptSignature(pad.strokes(), pad.width());
      before.forEach(b => {
        const it = b[0], pg = S.pages[it.page], h = sigH(it.w);
        it.y = clamp(b[1] - h, 0, Math.max(0, pg.H - h));
        paintObj(it); layoutObj(it);
      });
      closeSheet();
      afterAdopt(first, opts);
    });
    openSheet(S.sig ? tr('Unterschrift ändern') : tr('Unterschreiben'), body, { onClose: () => { padMem = pad.strokes(); pad.destroy(); } });
    requestAnimationFrame(() => requestAnimationFrame(pad.resize));
  }

  function afterAdopt(first, opts) {
    S.items.forEach(it => {
      if (it.type === 'text' && it.auto) { it.text = ortDatum(); paintObj(it); layoutObj(it); }
      if (it.type === 'sig') { paintObj(it); layoutObj(it); }
    });
    const open = S.spots.filter(s => !s.fill);
    if (open.length) {
      const filled = open.map(sp => fillSpot(sp, false)).filter(Boolean);
      select(null);
      renderBar();
      const sigs = filled.filter(i => i.type === 'sig');
      if (S.hashMatch !== false) banner('info', tr('Die markierten Stellen sind ausgefüllt. Prüfen Sie kurz alles und tippen Sie dann auf „Fertig“.'));
      scrollToObj(sigs[0] || filled[0]);
      if (sigs.length) toast(sigs.length > 1 ? tr('Unterschrift an {n} Stellen eingesetzt. Bitte kurz prüfen.', { n: sigs.length }) : tr('Unterschrift eingesetzt. Bitte kurz prüfen.'), 3600);
      return;
    }
    if (first || opts.via === 'add' || !S.items.some(i => i.type === 'sig')) {
      const it = placeSig(S.cur);
      renderBar();
      scrollToObj(it);
      toast(tr('Schieben Sie die Unterschrift an die richtige Stelle. Größe ändern: blauen Punkt ziehen.'), 4500);
      return;
    }
    renderBar();
    toast(tr('Unterschrift geändert.'));
  }

  function insertSigAgain() {
    const open = S.spots.filter(sp => !sp.fill && sp.k === 's');
    if (open.length) {
      const filled = open.map(sp => fillSpot(sp, false)).filter(Boolean);
      renderBar();
      scrollToObj(filled[0]);
      return;
    }
    const it = placeSig(S.cur);
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
    const body = el('div', { class: 'menu' },
      opt(I.pen, tr('Unterschrift einfügen'), tr('Auf Seite {n}, dann an die Stelle schieben', { n: S.cur + 1 }), () => { const it = placeSig(S.cur); scrollToObj(it); renderBar(); }),
      opt(I.cal, tr('Ort und Datum einfügen'), ortDatum(), () => placeText(S.cur, ortDatum(), true)),
      opt(I.text, tr('Text einfügen'), tr('Zum Beispiel Ihr Name in Druckschrift'), () => openTextSheet(null, '')),
      opt(I.redo, tr('Unterschrift neu zeichnen'), tr('Ersetzt die Unterschrift überall'), () => openPad({ via: 'resign' })));
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
    } else if (!S.sig) {
      const n = S.spots.filter(s => s.k === 's').length;
      row.append(el('button', { type: 'button', class: 'btn btn-primary btn-xl', onclick: () => openPad({ via: 'bar' }), html: I.pen + '<span>' + (n ? tr('Jetzt unterschreiben') : tr('Unterschreiben')) + '</span>' }));
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

  function requestLink(name, proof, withDoc) {
    const o = { v: 1, p: S.pages.length, s: S.spots.map(sp => [sp.k, sp.page + 1, Math.round(sp.x), Math.round(sp.y), Math.round(sp.w), Math.round(sp.h)]) };
    if (S.file.hash) o.h = S.file.hash.slice(0, 16);
    if (name) o.f = name.slice(0, 60);
    if (!proof) o.n = 0;
    if (withDoc && S.sent) { o.d = S.sent.id; o.k = S.sent.key; o.t = S.sent.del; if (S.sent.track) o.b = 1; }
    if (S.sendLang === 'sq') o.l = 'sq';
    return baseUrl() + '#r=' + toB64url(JSON.stringify(o));
  }

  function sendMessage(link, name) {
    if (S.sendLang === 'sq') {
      return 'Përshëndetje, ju lutem nënshkruani dokumentin në shtojcë. Kjo bëhet direkt në telefon:\n\n' +
        '1. Prekni PDF-në dhe ruajeni (iPhone: „Teilen“ → „In Dateien sichern“)\n' +
        '2. Hapni këtë link:\n' + link + '\n' +
        '3. Zgjidhni PDF-në, nënshkruajeni dhe ma dërgoni përsëri këtu.\n\n' +
        'Faleminderit!' + (name ? '\n' + name : '');
    }
    return 'Hallo, bitte unterschreiben Sie das Dokument im Anhang. Das geht direkt auf dem Handy:\n\n' +
      '1. Das PDF antippen und speichern (iPhone: Teilen → „In Dateien sichern“)\n' +
      '2. Diesen Link öffnen:\n' + link + '\n' +
      '3. Das PDF auswählen, unterschreiben und mir hier zurückschicken.\n\n' +
      'Vielen Dank!' + (name ? '\n' + name : '');
  }

  function linkMessage(link, name, expires, back) {
    if (S.sendLang === 'sq') {
      return 'Përshëndetje, ju lutem nënshkruani këtë dokument. ' +
        (back ? 'Thjesht hapeni linkun dhe nënshkruajeni me gisht. Dokumenti më vjen pastaj automatikisht:\n\n' : 'Thjesht hapeni linkun, nënshkruajeni me gisht dhe ma dërgoni përsëri këtu:\n\n') +
        link + '\n\n' +
        (expires ? 'Linku është i vlefshëm deri më ' + fmtDate(new Date(expires)) + '.\n\n' : '') +
        'Faleminderit!' + (name ? '\n' + name : '');
    }
    return 'Hallo, bitte unterschreiben Sie dieses Dokument. ' +
      (back ? 'Einfach den Link öffnen und mit dem Finger unterschreiben. Das Dokument kommt dann automatisch bei mir an:\n\n' : 'Einfach den Link öffnen, mit dem Finger unterschreiben und mir hier zurückschicken:\n\n') +
      link + '\n\n' +
      (expires ? 'Der Link ist bis ' + fmtDate(new Date(expires)) + ' gültig.\n\n' : '') +
      'Vielen Dank!' + (name ? '\n' + name : '');
  }

  async function openSendSheet() {
    select(null);
    busy('Einen Moment …');
    const srv = await serverStatus();
    unbusy();
    const cfg = loadSender();
    const nS = S.spots.filter(s => s.k === 's').length, nD = S.spots.filter(s => s.k === 'd').length;
    const name = el('input', { class: 'in', type: 'text', value: cfg.name || '', placeholder: 'z. B. Max Muster', autocomplete: 'name', maxlength: '60' });
    const proof = el('input', { type: 'checkbox' });
    proof.checked = cfg.proof !== false;
    const langBtns = ['de', 'sq'].map(l => el('button', { type: 'button', class: 'seg' + (S.sendLang === l ? ' on' : ''), 'aria-pressed': S.sendLang === l ? 'true' : 'false', text: l === 'de' ? 'Deutsch' : 'Shqip',
      onclick: () => {
        S.sendLang = l;
        langBtns.forEach((b, i) => { const on = ['de', 'sq'][i] === l; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        edited = false;
        refresh(true);
      } }));
    const langRow = el('div', { class: 'fld' }, el('span', { text: 'Sprache für den Kunden' }), el('div', { class: 'segrow' }, langBtns[0], langBtns[1]),
      el('small', { text: 'Ihr Kunde sieht die Seite und Ihre Nachricht in dieser Sprache. Die Nachweisseite im PDF bleibt Deutsch.' }));
    const viaLink = el('input', { type: 'checkbox' });
    viaLink.checked = srv.ok && cfg.viaLink !== false;
    const pinIn = el('input', { class: 'in', type: 'password', placeholder: 'mindestens 6 Zeichen', autocomplete: 'current-password', maxlength: '64' });
    const pinBox = el('label', { class: 'fld' }, el('span', { text: srv.pin ? 'Ihre Absender-PIN' : 'Absender-PIN festlegen' }), pinIn,
      el('small', { text: srv.pin ? 'Einmal eingeben, dieses Gerät merkt sie sich.' : 'Schützt Ihren Speicher: Nur mit dieser PIN können Dokumente hochgeladen werden. Dieses Gerät merkt sie sich.' }));
    const cust = el('input', { class: 'in', type: 'text', value: S.custLabel || '', placeholder: 'z. B. Max Mustermann, Kfz-Antrag', autocomplete: 'off', maxlength: '80' });
    const custBox = el('label', { class: 'fld' }, el('span', { text: 'Kunde / Notiz (nur für Ihre Übersicht)' }), cust);
    cust.addEventListener('input', () => {
      S.custLabel = cust.value;
      if (S.sent && S.sent.track) Store.patch(S.sent.id, { label: cleanLabel(cust.value) }).catch(() => {});
    });
    const err = el('p', { class: 'err', role: 'alert' });
    const msg = el('textarea', { class: 'in', rows: '9' });
    let edited = false, link = '';
    const linkMode = () => srv.ok && viaLink.checked;
    const willTrack = () => S.sent ? !!S.sent.track : (srv.v || 1) >= 2 && S.inbox.ok;
    const currentLink = () => linkMode() ? (S.sent ? requestLink(name.value.trim(), proof.checked, true) : LINK_PLACEHOLDER) : requestLink(name.value.trim(), proof.checked, false);
    const template = l => linkMode() ? linkMessage(l, name.value.trim(), S.sent && S.sent.expires, willTrack()) : sendMessage(l, name.value.trim());
    const refresh = (force) => {
      const nl = currentLink();
      if (edited && !force && link) msg.value = msg.value.split(link).join(nl);
      else msg.value = template(nl);
      link = nl;
      saveSender({ name: name.value.trim(), proof: proof.checked, viaLink: viaLink.checked });
      if (S.sent && S.sent.track && linkMode()) Store.patch(S.sent.id, { link: nl, lang: S.sendLang }).catch(() => {});
      render();
    };
    name.addEventListener('input', () => refresh(false));
    proof.addEventListener('change', () => refresh(false));
    viaLink.addEventListener('change', () => { edited = false; refresh(true); });
    msg.addEventListener('input', () => { edited = true; });

    const summary = nS || nD
      ? (nS ? nS + ' ' + plural(nS, 'Unterschriftsfeld', 'Unterschriftsfelder') : '') + (nS && nD ? ' und ' : '') + (nD ? nD + ' ' + plural(nD, 'Ort/Datum-Feld', 'Ort/Datum-Felder') : '') + ' markiert.'
      : 'Keine Felder markiert. Der Kunde setzt die Unterschrift dann selbst an die richtige Stelle.';

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
        busy('Dokument wird verschlüsselt …');
        S.sent = await uploadDoc(pin, p => busy('Wird hochgeladen … ' + Math.round(p * 100) + ' %'));
        S.sent.track = false;
        if ((srv.v || 1) >= 2) {
          // In der Übersicht merken (nur auf diesem Gerät). Dann kommt das PDF direkt hierher zurück.
          try {
            await Store.put({ id: S.sent.id, key: S.sent.key, del: S.sent.del, label: cleanLabel(cust.value), file: S.file.name, pages: S.pages.length,
              created: Date.now(), expires: S.sent.expires, lang: S.sendLang, status: 'open', link: '' });
            S.sent.track = true;
            S.dirty = false;
            askPersist();
          } catch (x) { console.warn('Übersicht nicht verfügbar:', x); }
        }
        unbusy();
        refresh(false);
        setTimeout(() => { try { actions.scrollIntoView({ block: 'end', behavior: 'smooth' }); } catch (x) { /* egal */ } }, 60);
        toast('Link erstellt. Jetzt per WhatsApp senden.');
      } catch (e) {
        unbusy();
        if (e.code === 'pin_wrong') { setPin(''); err.textContent = 'Die PIN stimmt nicht.'; render(); }
        else if (e.code === 'pin_short') err.textContent = 'Die PIN muss mindestens 6 Zeichen haben.';
        else if (e.code === 'too_large' || e.code === 'http_413') err.textContent = 'Das Dokument ist zu groß für den Link. Schalten Sie „Dokument im Link mitschicken“ aus und senden Sie das PDF als Anhang.';
        else err.textContent = 'Hochladen hat nicht geklappt. Bitte Internetverbindung prüfen und noch einmal versuchen.';
      }
    }

    async function shareText() {
      if (await shareMessage(msg.value)) S.dirty = false;
    }

    async function shareWithPdf() {
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
      const lm = linkMode();
      pinBox.classList.toggle('hidden', !lm || !!S.sent || !!getPin());
      custBox.classList.toggle('hidden', !lm);
      actions.innerHTML = '';
      linkInfo.innerHTML = '';
      if (lm && !S.sent) {
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
            el('a', { class: 'linkbtn', href: '#', text: 'Link als Kunde testen', onclick: e => { e.preventDefault(); window.open(link, '_blank', 'noopener'); } })));
      } else {
        actions.append(el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.share + '<span>PDF + Nachricht senden</span>', onclick: shareWithPdf }),
          el('div', { class: 'btnrow' },
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.copy + '<span>Text kopieren</span>', onclick: () => copyText(msg.value, 'Nachricht kopiert.') }),
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.download + '<span>PDF speichern</span>', onclick: () => download(S.file.bytes, S.file.name) })),
          el('div', { class: 'donelinks' },
            el('a', { class: 'linkbtn', href: '#', text: 'Link als Kunde testen', onclick: e => { e.preventDefault(); window.open(link, '_blank', 'noopener'); } })));
      }
    }

    const body = el('div', null,
      el('div', { class: 'banner' + (nS ? '' : ' warn') }, el('span', { html: nS ? I.check : I.info }), el('p', { text: summary + ' ' + S.pages.length + ' ' + plural(S.pages.length, 'Seite', 'Seiten') + '.' })),
      custBox,
      el('label', { class: 'fld' }, el('span', { text: 'Ihr Name (sieht der Kunde)' }), name),
      langRow,
      srv.ok ? el('label', { class: 'check' }, viaLink, el('span', null, 'Dokument im Link mitschicken', el('small', { text: willTrack()
        ? 'Ihr Kunde muss nichts speichern und nichts zurückschicken: Er unterschreibt über den Link, das PDF landet direkt in Ihrer Übersicht. Ende-zu-Ende verschlüsselt.'
        : 'Ihr Kunde muss nichts speichern: Er tippt auf den Link und das Dokument ist da. Ende-zu-Ende verschlüsselt, nach dem Zurückschicken bzw. nach 7 Tagen gelöscht.' }))) : null,
      el('label', { class: 'check' }, proof, el('span', null, 'Nachweisseite anhängen', el('small', { text: 'Eine Seite mit Name, Zeitpunkt und Prüfsumme kommt ans Ende. Damit lässt sich zeigen, wer was wann unterschrieben hat.' }))),
      pinBox,
      linkInfo,
      el('label', { class: 'fld' }, el('span', { text: 'Nachricht an den Kunden' }), msg),
      err,
      actions);
    refresh(true);
    openSheet('Per WhatsApp senden', body);
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

  function initInbox() {
    try { S.inbox.filter = localStorage.getItem(LS_FILTER) || 'all'; } catch (e) { /* egal */ }
    if (!/^(all|open|signed)$/.test(S.inbox.filter)) S.inbox.filter = 'all';
    loadInbox().then(() => { renderInbox(); refreshInbox(); });
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
  const recTitle = r => r.label || (r.status === 'signed' && r.signer) || r.file || 'Dokument';
  const pending = r => r.status === 'open' || (r.status === 'signed' && !r.local && !r.lost);

  function setFilter(f) {
    S.inbox.filter = f;
    try { localStorage.setItem(LS_FILTER, f); } catch (e) { /* egal */ }
    renderInbox();
  }

  function renderInbox() {
    const box = $('#inbox');
    if (!box) return;
    const send = S.mode === 'send';
    const list = send ? S.inbox.list.slice() : [];
    const has = list.length > 0;
    box.classList.toggle('hidden', !send || (!has && S.inbox.ok));
    $('#start').classList.toggle('has-inbox', send && has);
    box.innerHTML = '';
    if (!send) return;
    box.setAttribute('aria-label', 'Ihre Anfragen');
    if (!S.inbox.ok) {
      box.append(el('div', { class: 'banner warn' }, el('span', { html: I.warn }),
        el('p', { text: 'Die Übersicht kann in diesem Browser nicht gespeichert werden (zum Beispiel im privaten Modus). Links funktionieren trotzdem, Ihr Kunde schickt das PDF dann per WhatsApp zurück.' })));
      return;
    }
    if (!has) return;
    const nOpen = list.filter(r => r.status === 'open').length;
    const nDone = list.filter(r => r.status === 'signed').length;
    const nNew = list.filter(r => r.status === 'signed' && r.local && !r.seen).length;
    const f = S.inbox.filter;
    const segs = [['all', 'Alle', list.length], ['open', 'Offen', nOpen], ['signed', 'Erledigt', nDone]].map(x =>
      el('button', { type: 'button', class: 'seg' + (f === x[0] ? ' on' : ''), 'aria-pressed': f === x[0] ? 'true' : 'false', onclick: () => setFilter(x[0]) },
        x[1], el('span', { class: 'cnt' + (x[0] === 'signed' && nNew ? ' new' : ''), text: String(x[2]) })));
    const rows = list.filter(r => f === 'all' || r.status === f)
      .sort((a, b) => (b.status === 'signed' && b.local && !b.seen) - (a.status === 'signed' && a.local && !a.seen) || (b.signedAt || b.created) - (a.signedAt || a.created));
    box.append(
      el('div', { class: 'ibhead' },
        el('h2', { text: 'Ihre Anfragen' }),
        el('button', { type: 'button', class: 'iconbtn sm' + (refreshing ? ' turning' : ''), 'aria-label': 'Aktualisieren', html: I.refresh, onclick: () => refreshInbox(true) })),
      el('div', { class: 'segrow' }, segs[0], segs[1], segs[2]));
    if (rows.length) {
      const ul = el('ul', { class: 'iblist' });
      rows.forEach(r => ul.append(el('li', null, itemButton(r))));
      box.append(ul);
    } else {
      box.append(el('p', { class: 'ibempty', text: f === 'open' ? 'Keine offenen Anfragen.' : 'Noch nichts unterschrieben.' }));
    }
    const err = S.inbox.err;
    box.append(el('p', { class: 'ibnote' + (err ? ' warn' : ''), text:
      err === 'pin' ? 'Für den Abgleich fehlt die PIN. Tippen Sie oben auf Aktualisieren.'
        : err === 'offline' ? 'Keine Verbindung' + (S.inbox.last ? ', Stand ' + fmtTime(new Date(S.inbox.last)) + ' Uhr.' : '.') + ' Unterschriebene PDFs liegen nur auf diesem Gerät.'
          : (S.inbox.last ? 'Aktualisiert ' + fmtTime(new Date(S.inbox.last)) + ' Uhr. ' : '') + 'Unterschriebene PDFs liegen nur auf diesem Gerät.' }));
  }

  function itemButton(r) {
    const st = r.status, title = recTitle(r);
    let line, cls, icon;
    if (st === 'signed') {
      cls = 'ok'; icon = I.check;
      line = 'Unterschrieben ' + whenText(r.signedAt) + (r.signer && title !== r.signer ? ' · ' + r.signer : '');
      if (!r.local) line += r.lost ? ' · PDF nicht mehr abrufbar' : ' · wird geladen …';
    } else if (st === 'open') {
      cls = 'open'; icon = I.clock;
      line = 'Offen · gesendet ' + whenText(r.created) + ' · ' + leftText(r.expires);
    } else {
      cls = 'gone'; icon = I.xc;
      line = r.gone === 'withdrawn' ? 'Zurückgezogen' : 'Abgelaufen, nicht unterschrieben';
    }
    return el('button', { type: 'button', class: 'ibitem ' + cls, onclick: () => openRecord(r.id) },
      el('span', { class: 'ic', html: icon }),
      el('span', { class: 'tx' },
        el('b', null, el('span', { class: 'ttl', text: title }), st === 'signed' && r.local && !r.seen ? el('i', { class: 'new', text: 'Neu' }) : null),
        title !== r.file ? el('small', { text: r.file }) : null,
        el('span', { class: 'st', text: line })),
      el('span', { class: 'chev', html: I.chev }));
  }

  // Stand beim Server abfragen, neu unterschriebene PDFs abholen und dort löschen
  let refreshing = null, pollT = 0;
  function refreshInbox(manual) {
    if (S.mode !== 'send') return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = syncInbox(!!manual)
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
    const fresh = [];
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
        fresh.push(Object.assign({}, r, { signedAt: st.signedAt, sChunks: st.chunks }));
      } else if (st.expires && st.expires !== r.expires) {
        await Store.patch(r.id, { expires: st.expires });
      }
    }
    await loadInbox();
    renderInbox();
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
      signer: txt(h.signer, 80), ort: txt(h.ort, 60),
      outPages: Number.isInteger(h.pages) && h.pages > 0 ? h.pages : 0,
      size: doc.bytes.length,
      signedAt: r.signedAt || Date.parse(h.signedAt) || Date.now()
    };
    await Store.patch(r.id, changes);
    await deleteServerCopy(r.id, pin); // liegt jetzt nur noch auf diesem Gerät
    return Object.assign({}, r, changes);
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
    const until = r.expires ? fmtDate(new Date(r.expires)) : '';
    if (r.lang === 'sq') {
      return 'Përshëndetje, një kujtesë e vogël: ju lutem nënshkruani këtë dokument. Thjesht hapeni linkun dhe nënshkruajeni me gisht:\n\n' +
        r.link + '\n\n' + (until ? 'Linku është i vlefshëm deri më ' + until + '.\n\n' : '') + 'Faleminderit!' + (name ? '\n' + name : '');
    }
    return 'Hallo, kurze Erinnerung: Bitte unterschreiben Sie noch dieses Dokument. Einfach den Link öffnen und mit dem Finger unterschreiben:\n\n' +
      r.link + '\n\n' + (until ? 'Der Link ist bis ' + until + ' gültig.\n\n' : '') + 'Vielen Dank!' + (name ? '\n' + name : '');
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

  async function openRecord(id) {
    let r = null;
    try { r = await Store.get(id); } catch (e) { r = null; }
    if (!r) { await loadInbox(); renderInbox(); return; }
    if (r.status === 'signed' && r.local && !r.seen) {
      Store.patch(id, { seen: true }).then(loadInbox).then(renderInbox).catch(() => {});
    }
    const kv = el('dl', { class: 'kv' });
    const row = (k, v) => { if (v) kv.append(el('dt', { text: k }), el('dd', { text: v })); };
    const dt = ts => fmtDate(new Date(ts)) + ', ' + fmtTime(new Date(ts)) + ' Uhr';
    const label = el('input', { class: 'in', type: 'text', value: r.label || '', placeholder: 'z. B. Max Mustermann, Kfz-Antrag', maxlength: '80', autocomplete: 'off' });
    label.addEventListener('change', () => { Store.patch(id, { label: cleanLabel(label.value) }).then(loadInbox).then(renderInbox).catch(() => {}); });
    const note = el('label', { class: 'fld' }, el('span', { text: 'Kunde / Notiz (nur für Sie)' }), label);
    const body = el('div', { class: 'recdetail' });
    if (r.status === 'signed') {
      row('Unterschrieben von', r.signer);
      row('Zeitpunkt', r.signedAt ? dt(r.signedAt) : '');
      row('Ort', r.ort);
      row('Angefordert', fmtDate(new Date(r.created)));
      if (r.local) {
        const info = (r.outPages ? (r.outPages === 1 ? '1 Seite' : r.outPages + ' Seiten') + ' · ' : '') + fmtSize(r.size || 0);
        body.append(
          el('div', { class: 'filecard' }, el('span', { html: I.doc }), el('div', null, el('b', { text: r.outName || r.file }), el('span', { text: info }))),
          kv,
          el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.eye + '<span>Ansehen</span>', onclick: () => viewRecord(r) }),
          el('div', { class: 'btnrow' },
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.share + '<span>Teilen</span>', onclick: () => withPdf(r, shareFile) }),
            el('button', { type: 'button', class: 'btn btn-ghost', html: I.download + '<span>Speichern</span>', onclick: () => withPdf(r, (b, n) => { download(b, n); toast('PDF wird gespeichert.'); }) })),
          el('p', { class: 'hint left', text: 'Das PDF liegt nur auf diesem Gerät. Leiten Sie es am besten gleich weiter, zum Beispiel in die Kundenakte.' }),
          note,
          el('div', { class: 'donelinks' }, el('button', { type: 'button', class: 'linkbtn danger', text: 'Von diesem Gerät löschen', onclick: () => removeRecord(r) })));
      } else {
        body.append(kv,
          el('div', { class: 'banner' + (r.lost ? ' warn' : '') }, el('span', { html: r.lost ? I.warn : I.info }),
            el('p', { text: r.lost ? 'Das unterschriebene PDF ist auf dem Server nicht mehr vorhanden. Bitten Sie Ihren Kunden, es per WhatsApp zu schicken.' : 'Ihr Kunde hat unterschrieben. Das PDF wird gerade abgeholt.' })),
          r.lost ? null : el('button', { type: 'button', class: 'btn btn-primary btn-block', html: I.download + '<span>Jetzt abholen</span>', onclick: async () => { closeSheet(); await refreshInbox(true); openRecord(id); } }),
          note,
          el('div', { class: 'donelinks' }, el('button', { type: 'button', class: 'linkbtn danger', text: 'Aus der Übersicht entfernen', onclick: () => removeRecord(r) })));
      }
    } else if (r.status === 'open') {
      row('Dokument', r.file);
      row('Gesendet', dt(r.created));
      row('Gültig bis', fmtDate(new Date(r.expires)));
      row('Sprache', r.lang === 'sq' ? 'Shqip (Albanisch)' : 'Deutsch');
      body.append(
        el('div', { class: 'banner' }, el('span', { html: I.clock }), el('p', { text: 'Noch nicht unterschrieben. Sobald Ihr Kunde fertig ist, erscheint das PDF hier.' })),
        kv,
        r.link ? el('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', html: I.bell + '<span>Erinnerung senden</span>', onclick: () => shareMessage(reminderMessage(r)) }) : null,
        el('div', { class: 'btnrow' },
          r.link ? el('button', { type: 'button', class: 'btn btn-ghost', html: I.copy + '<span>Link kopieren</span>', onclick: () => copyText(r.link, 'Link kopiert.') }) : null,
          el('button', { type: 'button', class: 'btn btn-ghost', html: I.refresh + '<span>Status prüfen</span>', onclick: () => { closeSheet(); refreshInbox(true); } })),
        note,
        el('div', { class: 'donelinks' }, el('button', { type: 'button', class: 'linkbtn danger', text: 'Anfrage zurückziehen', onclick: () => withdrawRecord(r) })));
    } else {
      row('Dokument', r.file);
      row('Gesendet', dt(r.created));
      body.append(
        el('div', { class: 'banner warn' }, el('span', { html: I.warn }), el('p', { text: r.gone === 'withdrawn'
          ? 'Sie haben diese Anfrage zurückgezogen. Der Link funktioniert nicht mehr.'
          : 'Der Link ist abgelaufen, ohne dass unterschrieben wurde. Wählen Sie das PDF erneut aus, um eine neue Anfrage zu senden.' })),
        kv, note,
        el('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Aus der Übersicht entfernen', onclick: () => removeRecord(r) }));
    }
    openSheet(recTitle(r), body);
  }

  /* ---------------- PDF erstellen ---------------- */
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
      const head = { name: S.out.name, signer: S.name, ort: S.ort, signedAt: new Date().toISOString(), pages: S.out.pages, match: S.hashMatch };
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
    } catch (e) {
      console.warn('Zurücksenden:', e);
      S.sentBack = { ok: false, code: (e && e.code) || 'error' };
    }
    unbusy();
    showDone();
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

  function placementText() {
    const per = {};
    S.items.forEach(i => { if (i.type === 'sig') per[i.page + 1] = (per[i.page + 1] || 0) + 1; });
    return Object.keys(per).map(Number).sort((a, b) => a - b).map(p => 'Seite ' + p + (per[p] > 1 ? ' (' + per[p] + '×)' : '')).join(', ');
  }

  async function rasterize(L) {
    const out = await L.PDFDocument.create();
    for (let i = 0; i < S.pages.length; i++) {
      const pg = S.pages[i];
      busy(tr('Seite {a} von {b} wird übernommen …', { a: i + 1, b: S.pages.length }));
      const page = await S.pdf.getPage(i + 1);
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
    busy(tr('PDF wird erstellt …'));
    return out;
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
    const capText = safe(caption(now));
    const pages = doc.getPages();
    S.items.forEach(it => {
      const pg = S.pages[it.page], page = pages[it.page];
      if (!pg || !page) return;
      const M = raster ? [1, 0, 0, 1, 0, 0] : virtualToUser(pg);
      page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(M[0], M[1], M[2], M[3], M[4], M[5]), L.setLineJoin(L.LineJoinStyle.Round));
      if (it.type === 'sig') {
        const c = capSize(it.w);
        page.drawSvgPath(S.sig.path, { x: it.x, y: pg.H - (it.y + c * 1.6), scale: it.w / S.sig.bw, borderColor: ink, borderWidth: S.sig.sw, borderLineCap: L.LineCapStyle.Round });
        page.drawText(capText, { x: it.x, y: pg.H - (it.y + c * 1.1), size: c, font: F.reg, color: capColor });
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
    const base = S.file.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Dokument';
    return { bytes: bytes, name: base + '_unterschrieben.pdf', pages: doc.getPageCount() };
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
    row('Dokument', S.file.name);
    row('Umfang', n + ' ' + plural(n, 'Seite', 'Seiten') + ' Original, dazu diese Nachweisseite');
    if (S.file.hash) row('Prüfsumme (SHA-256)', '', { mono: true, lines: [S.file.hash.slice(0, 32), S.file.hash.slice(32)] });
    if (S.req) {
      if (S.req.f) row('Angefordert von', S.req.f);
      row('Abgleich mit Anfrage', S.hashMatch === true
        ? 'Stimmt überein: Es wurde genau das angeforderte Dokument unterschrieben.'
        : S.hashMatch === false ? 'Abweichend: Das unterschriebene PDF ist nicht identisch mit dem angeforderten Dokument.' : 'Nicht prüfbar.');
    }
    row('Unterzeichnet von', S.name, { bold: true });
    if (S.ort) row('Ort', S.ort);
    row('Zeitpunkt', fmtDate(now) + ', ' + fmtTime(now, true) + ' Uhr (' + tzLabel(now) + ')');
    row('Unterschrift auf', placementText());
    if (S.fileIsRemote) row('Übermittlung', backMode() ? 'Ende-zu-Ende verschlüsselt per Link erhalten und zurückgegeben' : 'Per Ende-zu-Ende-verschlüsseltem Link erhalten');
    row('Gerät', deviceLabel());
    page.drawText(safe('Unterschrift'), { x: X, y: y, size: 9, font: F.bold, color: cMuted });
    const sc = Math.min(230 / S.sig.bw, 72 / S.sig.bh);
    const top = y + 9;
    page.pushOperators(L.pushGraphicsState(), L.setLineJoin(L.LineJoinStyle.Round));
    page.drawSvgPath(S.sig.path, { x: V, y: top, scale: sc, borderColor: ink, borderWidth: S.sig.sw, borderLineCap: L.LineCapStyle.Round });
    page.pushOperators(L.popGraphicsState());
    y = top - S.sig.bh * sc - 5;
    page.drawLine({ start: { x: V, y: y }, end: { x: V + 230, y: y }, thickness: 0.6, color: cLine });
    y -= 34;
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
    const mark = $('#doneMark'), retry = $('#retryBtn'), share = $('#shareBtn'), dl = $('#dlBtn');
    mark.classList.toggle('bad', !!(sb && !sb.ok));
    mark.innerHTML = sb && !sb.ok ? I.warnL : I.checkL;
    $('#editBtn').classList.toggle('hidden', !!(sb && sb.ok));
    $('#newBtn').classList.toggle('hidden', !!sb);
    retry.classList.add('hidden');
    $('#dlLabel').textContent = tr('PDF speichern');
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
    showScreen('start');
    if (S.mode === 'send') { loadInbox().then(renderInbox); refreshInbox(); }
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
