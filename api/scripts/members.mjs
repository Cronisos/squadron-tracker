// Gestion des membres depuis ton PC.
// Usage : API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs add "Nom CMDR"
//         API_URL=... ADMIN_TOKEN=... node api/scripts/members.mjs remove "Nom CMDR"

const [action, cmdr] = process.argv.slice(2);
const { API_URL, ADMIN_TOKEN } = process.env;

if (!['add', 'remove'].includes(action) || !cmdr || !API_URL || !ADMIN_TOKEN) {
  console.error('Usage : API_URL=... ADMIN_TOKEN=... node members.mjs add|remove "Nom CMDR"');
  process.exit(1);
}

const headers = { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' };
const response = action === 'add'
  ? await fetch(`${API_URL}/admin/members`, { method: 'POST', headers, body: JSON.stringify({ cmdr }) })
  : await fetch(`${API_URL}/admin/members/${encodeURIComponent(cmdr)}`, { method: 'DELETE', headers });

if (!response.ok) {
  console.error(`Refusé : erreur ${response.status}`);
  process.exit(1);
}
const result = await response.json();
console.log(action === 'add' ? `Jeton de ${cmdr}, à transmettre en privé : ${result.token}` : `${cmdr} retiré, mérites effacés.`);
