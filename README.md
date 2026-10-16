# Firmio

Dokumente per Handy unterschreiben lassen. Der Kunde öffnet einen Link, unterschreibt mit dem Finger und tippt auf „Fertig“. Das unterschriebene PDF landet automatisch in der Übersicht des Absenders. Sitzt der Kunde gegenüber, unterschreibt er direkt auf dem Handy des Absenders („Vor Ort“). Die Kundenseite gibt es auf Deutsch und Albanisch.

## So funktioniert der Datenschutz

- Das PDF wird **auf dem Handy des Absenders verschlüsselt** (AES-256-GCM), bevor es hochgeladen wird.
- Der Schlüssel steckt nur im Link hinter dem `#` und wird nie an den Server übertragen. Netlify speichert nur verschlüsselte Daten.
- Unterschreibt der Kunde, wird das fertige PDF **auf seinem Handy mit demselben Schlüssel verschlüsselt** und für den Absender bereitgelegt. Das Original wird dann gelöscht.
- Die App des Absenders holt das unterschriebene PDF ab, entschlüsselt es und speichert es **nur auf diesem Gerät**. Danach wird es auf dem Server gelöscht. Übrig bleibt nur ein leerer Vermerk (Zeitpunkte, keine Inhalte), damit der Kunde beim erneuten Öffnen „bereits unterschrieben“ sieht.
- Offene Anfragen werden nach 7 Tagen gelöscht, nicht abgeholte unterschriebene nach 30 Tagen (tägliche Bereinigung).
- Der Link ist kurz: Hinter dem `#` steht nur ein zufälliges Geheimnis (22 Zeichen). Daraus leitet der Browser die Kennung beim Server, den Schlüssel und das Rückgabe-Token ab. Alle Angaben zur Anfrage (Absender, Sprache, markierte Stellen) liegen verschlüsselt beim Server.
- Benachrichtigungen (Web Push) aufs Handy des Absenders enthalten nur die zufällige Kennung der Anfrage, keine Namen oder Inhalte. Den Kundennamen setzt das Handy selbst aus der lokalen Übersicht ein.
- Hochladen, Abfragen und Abholen gehen nur mit der Absender-PIN.
- **Vor Ort** unterschriebene Dokumente werden gar nicht hochgeladen; sie landen direkt in der Übersicht auf dem Gerät.
- Der **Kundenname aus dem PDF** wird nur auf dem Handy des Absenders gelesen; dafür wird nichts hochgeladen.
- Die **Vorschau-Karte in WhatsApp** ist für alle Links gleich (Startseite und Vorschaubild). WhatsApp lädt sie auf dem Handy des Absenders; der Teil des Links nach „#“ wird dabei nicht übertragen.
- Der Name des Kunden (und der zweiten Person) zum Vorausfüllen, der Titel des Dokuments und die Namen zusammengefügter PDFs stehen nur in den verschlüsselten Angaben (kurzer Link) – nie im Link selbst und nie lesbar beim Server.
- **„Geöffnet“:** Beim ersten Öffnen des Links merkt sich der Server nur den Zeitpunkt (ohne Namen oder Inhalte). Die Kundenseite sagt das im Datenschutzhinweis. „Link als Kunde testen“ zählt nicht. Nach der Unterschrift wird der Vermerk gelöscht.
- **„Stimmt etwas nicht?“:** Die Nachricht des Kunden wird wie das Dokument Ende-zu-Ende verschlüsselt (Schlüssel aus dem Link), liegt höchstens bis zum Abholen beim Server und wird dann gelöscht. Die Benachrichtigung enthält nur die Kennung.
- **Vorlagen** speichern nur die Lage der Felder, Seitenformate und kurze Prüfsummen der Wörter (zum Wiedererkennen), keinen Text.
- **Erinnerungen** (täglich morgens) enthalten nur Kennungen. Der Server merkt sich nur, zu welchen Kennungen er schon erinnert hat.
- **Sicherungen** erstellt der Absender selbst als ZIP-Datei (unterschriebene PDFs, Inhaltsverzeichnis, Übersicht, Vorlagen; ohne PIN).
- **Kopie per E-Mail** (nur wenn eingeschaltet): Dann schickt der Kunde das fertige PDF zusätzlich TLS-verschlüsselt an den Server, der es über das Gmail-Konto des Absenders (App-Passwort) an die eingetragene Adresse mailt und nicht speichert. Das ist nicht mehr nur Ende-zu-Ende verschlüsselt; die Kundenseite sagt das dann im Datenschutzhinweis. Zugangsdaten liegen nur auf dem Server (nie im Browser, nie in einer Sicherung).

## Aufbau

| Ordner / Datei | Inhalt |
| --- | --- |
| `public/` | Die App (Startseite, Unterschreiben, Absender-Modus mit Übersicht unter `#absender`) |
| `netlify/functions/api.mjs` | Nimmt verschlüsselte Dokumente und Rückgaben an, gibt sie aus, löscht sie |
| `netlify/functions/cleanup.mjs` | Löscht täglich abgelaufene Anfragen |
| `netlify/functions/remind.mjs` | Erinnert morgens an Anfragen, die seit 2 Tagen offen sind oder bald ablaufen |
| `netlify/lib/push.mjs` | Benachrichtigungen (Web Push), gemeinsam für beide Functions |
| `netlify/lib/mail.mjs` | Kopie per E-Mail (Gmail per SMTP mit App-Passwort, alternativ Brevo) |
| `netlify.toml` | Netlify-Einstellungen (Ordner `public`, Functions) |

## Einrichtung bei Netlify (einmalig)

1. Im Netlify-Projekt: **Project configuration → Developer settings → Continuous deployment → Repository → Link repository**.
2. **GitHub** wählen und das Repository **firmio** auswählen. Alle Einstellungen kommen aus `netlify.toml`.
3. Netlify baut und veröffentlicht automatisch. Jede Änderung in diesem Repository wird automatisch live.
4. Beim ersten Link legst du in der App eine **Absender-PIN** fest (mindestens 6 Zeichen). Alternativ: Umgebungsvariable `FIRMIO_PIN` in Netlify setzen.

## Benutzung

- **Anfordern:** `https://<dein-projekt>.netlify.app/#absender` öffnen, PDF wählen, Felder auf die Linien ziehen, „Weiter“, Kunde/Notiz eintragen, Sprache (Deutsch/Shqip) wählen, „Link erstellen“, „Per WhatsApp senden“.
- **Kunde:** öffnet den Link, unterschreibt und tippt auf „Fertig – Dokument senden“. Er muss nichts speichern und nichts zurückschicken.
- **Vor Ort:** „Vor Ort unterschreiben“ antippen, PDF wählen, Felder setzen, „Weiter“, Kunde eintragen, „Jetzt unterschreiben lassen“ und das Handy übergeben. Danach „Zur Übersicht“.
- **Felder automatisch markieren:** Beim Öffnen eines PDFs sucht Firmio nach Beschriftungen wie „Unterschrift Antragsteller“, „Unterschrift des Versicherungsnehmers“, „Kontoinhaber“, „gesetzlicher Vertreter“ und „Unterschrift: ____“ und setzt die gelben Unterschriftsfelder auf die Linien. Ort/Datum setzt der Absender selbst (Knopf „Ort/Datum“). Überschriften und Fließtext bleiben außen vor; passt eine Vorlage, gilt die Vorlage. Abschaltbar unter Einstellungen → Felder und Vorlagen. Funktioniert bei PDFs mit Text (nicht bei reinen Scans).
- **Name vorausfüllen:** Der Name unter „Kunde“ wird beim Unterschreiben schon eingetragen (abschaltbar).
- **Aussehen in WhatsApp:** Die Nachricht beginnt mit dem Dokumentnamen in Fett (z. B. „*Antrag Hausrat* ✍️“, folgt dem Feld „Dokument“). Darüber zeigt WhatsApp eine große Vorschau-Karte mit „Jetzt öffnen“; ein Tipp darauf öffnet den Link. Knöpfe direkt unter der Nachricht gibt es nur über die kostenpflichtige WhatsApp-Business-Schnittstelle, nicht mit der normalen WhatsApp-App.
- **Kundenname aus dem PDF:** Beim Öffnen liest Firmio den Namen des Kunden aus dem PDF (Anschriftfeld mit „Herrn“/„Frau“, „Versicherungsnehmer“/„Antragsteller“, „Name, Vorname“, getrennte Felder „Name“ und „Vorname“, ausgefüllte Formularfelder, gedruckter Name unter „Unterschrift Versicherungsnehmer“) und trägt ihn unter „Kunde“ ein – mit dem Hinweis „Aus dem PDF übernommen. Bitte kurz prüfen.“ Übergangen werden der eigene Name, Namen aus dem eigenen Zusatz (z. B. „Hauptvertretung …“), Vermittler-, Berater- und Ansprechpartner-Angaben, versicherte Personen und Platzhalter wie „Max Mustermann“. Findet sich nichts Eindeutiges, bleibt das Feld leer.
- **Eigene Unterschrift (Vermittler):** Einmal unter Einstellungen → Meine Unterschrift zeichnen. Firmio sucht beim Öffnen eines PDFs nach „Unterschrift Vermittler“ (auch Berater, Vertreter, Makler, „Stempel und Unterschrift des Vermittlers“, „Unterschrift Berater: ____“) und setzt sie auf die Linie. Mit dem Stift oben im Dokument lässt sie sich auch selbst setzen, verschieben oder in der Größe ändern. Beim Senden (Link oder vor Ort) wird sie fest ins PDF geschrieben, mit Name und Zeitpunkt darunter; Vorlagen merken sich ihre Lage.
- **Vorlagen:** Beim Senden „Felder als Vorlage merken“ ankreuzen. Kommt dasselbe Formular wieder, setzt Firmio die Felder automatisch („Rückgängig“ möglich). Bei mehreren PDFs bekommt jedes PDF seine eigene Vorlage. Verwalten unter Einstellungen → Vorlagen.
- **Mehrere PDFs in einem Link:** Beim Auswählen mehrere PDFs auf einmal markieren oder im Dokument unten „Weiteres PDF anhängen“ (z. B. Beratungsdoku, SEPA-Mandat). Firmio fügt sie auf dem Handy zu einem Dokument zusammen, erkennt die Felder bzw. setzt die Vorlage je PDF; „Entfernen“ an der Überschrift nimmt ein PDF wieder heraus. Der Kunde unterschreibt alles in einem Rutsch, zurück kommt ein PDF. Geschützte PDFs werden als Bild übernommen.
- **Zweite Person:** Ein Unterschriftsfeld antippen und oben „2. Person“ wählen (das Feld wird blau), z. B. für den Ehepartner als Kontoinhaber. Beim Senden steht ein Feld für ihren Namen bereit. Beim Kunden unterschreiben beide nacheinander auf demselben Handy (auch vor Ort), jede Unterschrift trägt den eigenen Namen; die Nachweisseite zeigt beide.
- **Dateinamen:** Das unterschriebene PDF heißt „Datum Name Dokument.pdf“, z. B. „2026-10-11 Arben Hoxha Antrag Hausrat.pdf“ (bei zwei Personen „Arben & Drita Hoxha“). Den Dokumentnamen (sieht der Kunde) ändert man beim Senden unter „Dokument“. So heißt auch der Anhang der Mail-Kopie.
- **Geöffnet und Rückmeldungen:** In der Übersicht steht bei offenen Anfragen „Geöffnet“, sobald der Kunde den Link geöffnet hat. Am Ende des Dokuments kann der Kunde mit „Stimmt etwas nicht?“ kurz schreiben, was falsch ist; der Absender bekommt eine Benachrichtigung und sieht die Nachricht als „Rückmeldung“ bei der Anfrage.
- **Übersicht:** Auf der Startseite des Absenders stehen alle Anfragen; die Zahlen oben filtern nach „Offen“ und „Erledigt“, ab vier Einträgen gibt es eine Suche (Kunde, Notiz, Datei, Datum). Ein Tipp auf eine erledigte Anfrage zeigt das PDF; von dort lässt es sich teilen oder speichern. Offene Anfragen lassen sich erinnern oder zurückziehen.
- **Erinnerung:** Mit eingeschalteten Benachrichtigungen kommt morgens ein Hinweis, wenn eine Anfrage seit 2 Tagen offen ist oder ihr Link bald abläuft. Ein Tipp öffnet die Anfrage mit „Erinnerung senden“.
- **Sicherung:** Einstellungen → Sicherung → „Jetzt sichern“ erstellt eine ZIP-Datei (z. B. für Google Drive). „Einspielen“ holt alles auf ein neues Handy.
- **Kopie per E-Mail:** Einstellungen → Kopie per E-Mail → Ziel-Adresse (z. B. Büro-Postfach), Gmail-Adresse und ein Google-App-Passwort eintragen (Google-Konto → Bestätigung in zwei Schritten an → myaccount.google.com/apppasswords). Danach geht jedes unterschriebene PDF automatisch per Mail raus, sobald der Kunde auf „Fertig“ tippt – auch bei „Vor Ort“. Klappt die Mail beim Kunden nicht, schickt das Handy des Absenders sie beim nächsten Abgleich.
- Die Übersicht liegt nur auf dem Gerät, auf dem der Link erstellt wurde. Unterschriebene PDFs am besten gleich weiterleiten oder sichern. Auf dem iPhone die App über „Zum Home-Bildschirm“ installieren und dann immer von dort aus senden (Safari und App haben getrennte Speicher).
- Ohne Server-Teil (z. B. reiner Upload per Netlify Drop) funktioniert die App weiter: Dann schickt man PDF und Link getrennt, und der Kunde schickt das PDF per WhatsApp zurück.

## Rechtliches

Firmio erzeugt eine **einfache elektronische Signatur**. Wo das Gesetz die Schriftform verlangt, reicht sie nicht. Impressum und eigener Datenschutztext lassen sich in `public/config.js` eintragen.

Lizenzen: pdf.js (Apache 2.0), pdf-lib (MIT), @netlify/blobs (MIT), web-push (MPL 2.0), nodemailer (MIT-0), Source Sans 3 und Source Serif 4 (SIL OFL 1.1). Siehe `public/lizenzen`.
