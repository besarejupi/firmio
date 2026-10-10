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
- Der Name des Kunden zum Vorausfüllen steht nur in den verschlüsselten Angaben (kurzer Link) – nie im Link selbst und nie lesbar beim Server.
- **Vorlagen** speichern nur die Lage der Felder, Seitenformate und kurze Prüfsummen der Wörter (zum Wiedererkennen), keinen Text.
- **Erinnerungen** (täglich morgens) enthalten nur Kennungen. Der Server merkt sich nur, zu welchen Kennungen er schon erinnert hat.
- **Sicherungen** erstellt der Absender selbst als ZIP-Datei (unterschriebene PDFs, Inhaltsverzeichnis, Übersicht, Vorlagen; ohne PIN).

## Aufbau

| Ordner / Datei | Inhalt |
| --- | --- |
| `public/` | Die App (Startseite, Unterschreiben, Absender-Modus mit Übersicht unter `#absender`) |
| `netlify/functions/api.mjs` | Nimmt verschlüsselte Dokumente und Rückgaben an, gibt sie aus, löscht sie |
| `netlify/functions/cleanup.mjs` | Löscht täglich abgelaufene Anfragen |
| `netlify/functions/remind.mjs` | Erinnert morgens an Anfragen, die seit 2 Tagen offen sind oder bald ablaufen |
| `netlify/lib/push.mjs` | Benachrichtigungen (Web Push), gemeinsam für beide Functions |
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
- **Name vorausfüllen:** Der Name unter „Kunde“ wird beim Unterschreiben schon eingetragen (abschaltbar).
- **Vorlagen:** Beim Senden „Felder als Vorlage merken“ ankreuzen. Kommt dasselbe Formular wieder, setzt Firmio die Felder automatisch („Rückgängig“ möglich). Verwalten unter Einstellungen → Vorlagen.
- **Übersicht:** Auf der Startseite des Absenders stehen alle Anfragen; die Zahlen oben filtern nach „Offen“ und „Erledigt“, ab vier Einträgen gibt es eine Suche (Kunde, Notiz, Datei, Datum). Ein Tipp auf eine erledigte Anfrage zeigt das PDF; von dort lässt es sich teilen oder speichern. Offene Anfragen lassen sich erinnern oder zurückziehen.
- **Erinnerung:** Mit eingeschalteten Benachrichtigungen kommt morgens ein Hinweis, wenn eine Anfrage seit 2 Tagen offen ist oder ihr Link bald abläuft. Ein Tipp öffnet die Anfrage mit „Erinnerung senden“.
- **Sicherung:** Einstellungen → Sicherung → „Jetzt sichern“ erstellt eine ZIP-Datei (z. B. für Google Drive). „Einspielen“ holt alles auf ein neues Handy.
- Die Übersicht liegt nur auf dem Gerät, auf dem der Link erstellt wurde. Unterschriebene PDFs am besten gleich weiterleiten oder sichern. Auf dem iPhone die App über „Zum Home-Bildschirm“ installieren und dann immer von dort aus senden (Safari und App haben getrennte Speicher).
- Ohne Server-Teil (z. B. reiner Upload per Netlify Drop) funktioniert die App weiter: Dann schickt man PDF und Link getrennt, und der Kunde schickt das PDF per WhatsApp zurück.

## Rechtliches

Firmio erzeugt eine **einfache elektronische Signatur**. Wo das Gesetz die Schriftform verlangt, reicht sie nicht. Impressum und eigener Datenschutztext lassen sich in `public/config.js` eintragen.

Lizenzen: pdf.js (Apache 2.0), pdf-lib (MIT), @netlify/blobs (MIT), web-push (MPL 2.0), Source Sans 3 und Source Serif 4 (SIL OFL 1.1). Siehe `public/lizenzen`.
