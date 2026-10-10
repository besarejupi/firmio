# Firmio

Dokumente per Handy unterschreiben lassen. Der Kunde öffnet einen Link, unterschreibt mit dem Finger und schickt das PDF per WhatsApp zurück. Die Kundenseite gibt es auf Deutsch und Albanisch.

## So funktioniert der Datenschutz

- Das PDF wird **auf dem Handy des Absenders verschlüsselt** (AES-256-GCM), bevor es hochgeladen wird.
- Der Schlüssel steckt nur im Link hinter dem `#` und wird nie an den Server übertragen. Netlify speichert nur verschlüsselte Daten.
- Das Dokument wird gelöscht, sobald der Kunde es zurückgeschickt hat, spätestens nach 7 Tagen (tägliche Bereinigung).
- Unterschrift, Name und das unterschriebene PDF des Kunden werden nie hochgeladen.
- Hochladen geht nur mit der Absender-PIN.

## Aufbau

| Ordner / Datei | Inhalt |
| --- | --- |
| `public/` | Die App (Startseite, Unterschreiben, Absender-Modus unter `#absender`) |
| `netlify/functions/api.mjs` | Nimmt verschlüsselte Dokumente an, gibt sie aus, löscht sie |
| `netlify/functions/cleanup.mjs` | Löscht täglich abgelaufene Dokumente |
| `netlify.toml` | Netlify-Einstellungen (Ordner `public`, Functions) |

## Einrichtung bei Netlify (einmalig)

1. Im Netlify-Projekt: **Project configuration → Developer settings → Continuous deployment → Repository → Link repository**.
2. **GitHub** wählen und das Repository **firmio** auswählen. Alle Einstellungen kommen aus `netlify.toml`.
3. Netlify baut und veröffentlicht automatisch. Jede Änderung in diesem Repository wird automatisch live.
4. Beim ersten Link legst du in der App eine **Absender-PIN** fest (mindestens 6 Zeichen). Alternativ: Umgebungsvariable `FIRMIO_PIN` in Netlify setzen.

## Benutzung

- **Anfordern:** `https://<dein-projekt>.netlify.app/#absender` öffnen, PDF wählen, Felder auf die Linien ziehen, „Weiter“, Sprache (Deutsch/Shqip) wählen, „Link erstellen“, „Per WhatsApp senden“.
- **Kunde:** öffnet den Link, unterschreibt, schickt das PDF per WhatsApp zurück.
- Ohne Server-Teil (z. B. reiner Upload per Netlify Drop) funktioniert die App weiter: Dann schickt man PDF und Link getrennt.

## Rechtliches

Firmio erzeugt eine **einfache elektronische Signatur**. Wo das Gesetz die Schriftform verlangt, reicht sie nicht. Impressum und eigener Datenschutztext lassen sich in `public/config.js` eintragen.

Lizenzen: pdf.js (Apache 2.0), pdf-lib (MIT), @netlify/blobs (MIT). Siehe `public/lizenzen`.
