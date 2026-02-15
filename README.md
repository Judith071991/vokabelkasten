# VokabelKasten (Supabase + Next.js)

## Deploy (GitHub → Vercel)
1. Repo auf GitHub erstellen und diese Dateien hochladen
2. Vercel → New Project → Import Git Repository
3. Environment Variables in Vercel setzen:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY   (bei dir: Publishable key)
   - SUPABASE_SERVICE_ROLE_KEY       (Secret key – nur in Vercel, nie im Browser!)
4. Deploy

## Routen
- Login: /
- Training: /train
- Admin: /admin (nur wenn User in `admins` ist)

## Login
Schüler geben `username + passwort` ein. Intern nutzt die App `${username}@schule.local`.
