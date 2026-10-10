#!/bin/sh
# Firmio – Build bei Netlify: schreibt die Versionsnummer (Commit) in die App.
# Damit merkt die installierte App beim Öffnen, dass es eine neue Version gibt,
# und lädt sich selbst neu. Darf den Build nie abbrechen lassen.
V=$(printf '%s' "${COMMIT_REF:-dev}" | tr -cd 'A-Za-z0-9' | cut -c1-12)
[ -n "$V" ] || V=dev
printf '%s\n' "$V" > public/version.txt || true
sed -i "s/data-version=\"[^\"]*\"/data-version=\"$V\"/" public/index.html || true
# Vorschaubild für WhatsApp braucht eine vollständige Adresse
SITE=$(printf '%s' "${URL:-https://firmio.netlify.app}" | tr -cd 'A-Za-z0-9:/._-')
sed -i "s#__SITE__#$SITE#g" public/index.html || true
echo "Firmio-Version: $V"
exit 0
