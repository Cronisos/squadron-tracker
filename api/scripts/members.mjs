// Gestion des membres depuis ton PC.
// Usage : API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs list
//         API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs add "Nom CMDR"     (nouveau jeton, mérites gardés)
//         API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs remove "Nom CMDR"  (jeton coupé, mérites effacés)

const [action, cmdr] = process.argv.slice(2);
const { API_URL, ADMIN_TOKEN } = process.env;

if (!['list', 'add', 'remove'].includes(action) || (action !== 'list' && !cmdr) || !API_URL || !ADMIN_TOKEN) {
  console.error('Usage : API_URL=... ADMIN_TOKEN=... node members.mjs list | add "Nom CMDR" | remove "Nom CMDR"');
  process.exit(1);
}

const headers = { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' };
const base = API_URL.replace(/\/+$/, '');
const response = action === 'list'
  ? await fetch(`${base}/admin/members`, { headers })
  : action === 'add'
    ? await fetch(`${base}/admin/members`, { method: 'POST', headers, body: JSON.stringify({ cmdr }) })
    : await fetch(`${base}/admin/members/${encodeURIComponent(cmdr)}`, { method: 'DELETE', headers });

if (!response.ok) {
  console.error(`Refusé : erreur ${response.status}`);
  process.exit(1);
}
const result = await response.json();
if (action === 'list') {
  for (const m of result.members) console.log(`${m.cmdr}  (inscrit le ${m.created_at.slice(0, 10)})`);
  console.log(`${result.members.length} membre(s).`);
} else {
  console.log(action === 'add' ? `Jeton de ${cmdr}, à transmettre en privé : ${result.token}` : `${cmdr} retiré, mérites effacés.`);
}
