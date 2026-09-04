# Bot Discord de pontaj simplu

Botul creează automat un singur canal, `#pontaj`, atunci când este adăugat pe un server. În acel canal afișează panoul de pontaj cu cele patru butoane cerute. Nu creează canal de loguri și nu folosește roluri speciale.

## Butoanele

- **Start Pontaj** — trimite public mesajul „@member a pornit pontajul.” și pornește temporizatorul invizibil al acelui membru.
- **Stop Pontaj** — arată numai membrului care a apăsat mesajul „@member a oprit pontajul. Durata pontajului: 1h 45m.” și adaugă sesiunea la total.
- **Total Pontaj Propriu** — arată numai membrului care apasă butonul propriul total cumulativ.
- **Total Pontaj Angajați** — arată numai membrului care apasă butonul lista tuturor membrilor care au pontat și totalul lor cumulativ, de exemplu `@DolarDiamantu — 1h 45m`.

Timpul este reținut într-o bază locală SQLite, inclusiv după repornirea botului. Dacă un membru verifică un total cât timp pontajul lui este activ, timpul trecut până atunci este inclus în rezultat.

## Instalare

Ai nevoie de Node.js 20 sau mai nou și de un bot creat în [Discord Developer Portal](https://discord.com/developers/applications).

1. În Discord Developer Portal, creează o aplicație. Din pagina **Bot**, copiază tokenul și păstrează-l secret.
2. La **OAuth2 → URL Generator**, selectează scope-urile `bot` și `applications.commands`. Pentru bot selectează: **View Channels**, **Send Messages**, **Embed Links**, **Read Message History** și **Manage Channels**.
3. Invită botul pe server. Permisiunea **Manage Channels** este necesară doar pentru ca botul să creeze automat `#pontaj`.
4. Copiază `.env.example` ca `.env`, apoi completează `DISCORD_TOKEN` și `DISCORD_CLIENT_ID`.
5. În terminal, din acest dosar, rulează:

   ```bash
   npm install
   npm run deploy
   npm start
   ```

La prima pornire, botul creează `#pontaj` și pune panoul în acel canal. Dacă panoul a fost șters, un administrator cu permisiunea **Manage Channels** poate rula `/recreeaza-panou-pontaj`.

`npm run deploy` publică comenzile de recuperare și resetare și elimină comenzile vechi ale versiunii anterioare. Dacă ai setat opțional `DISCORD_GUILD_ID` în `.env`, acestea apar imediat pe acel server.

## Resetarea pontajului

Comanda `/resetpontaj confirmare:true` șterge **toate** sesiunile active și toate totalurile cumulative de pe server. Răspunsul de confirmare este privat.

Implicit, Discord ascunde comanda tuturor în afară de administratorii serverului. Pentru a permite și unui al doilea rol de administrator:

1. Activează Developer Mode în Discord și copiază ID-ul rolului.
2. Adaugă ID-ul în `.env`, de exemplu: `RESET_ROLE_IDS=123456789012345678`.
3. În Discord, deschide **Server Settings → Integrations → [botul tău] → Manage** și permite rolului respectiv comanda `/resetpontaj`.
4. Rulează `npm run deploy`, apoi repornește botul cu `npm start`.

Botul verifică și ID-ul acelui rol înainte de resetare, astfel încât un rol care nu este configurat nu poate folosi comanda chiar dacă o vede.

## Fișiere importante

- `.env` — tokenul și ID-ul aplicației; nu îl publica.
- `RESET_ROLE_IDS` — ID-urile rolurilor suplimentare care pot reseta pontajul.
- `data/pontaj.sqlite` — baza de date creată automat cu sesiunile și totalurile.
