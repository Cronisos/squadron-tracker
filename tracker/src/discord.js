// Publie dans Discord par webhook. Aucune mention possible, et l'adresse secrète n'apparaît jamais dans les erreurs.

const NO_MENTIONS = { parse: [] };

function form(file, filename, type, content) {
  const body = new FormData();
  body.append('payload_json', JSON.stringify({
    ...(content ? { content: String(content).slice(0, 2000) } : {}),
    allowed_mentions: NO_MENTIONS,
    attachments: [{ id: 0, filename }],
  }));
  body.append('files[0]', new Blob([file], { type }), filename);
  return body;
}

/** `content` : texte du message, sous l'image (2 000 caractères au plus, sans mention possible). */
export async function postImage(webhook, file, filename, type, fetcher = fetch, content = '') {
  const response = await fetcher(`${webhook}?wait=true`, { method: 'POST', body: form(file, filename, type, content) });
  if (!response.ok) throw new Error(`Publication Discord refusée : ${response.status}`);
  return (await response.json()).id;
}

/** Un message déjà supprimé à la main n'est pas une erreur. */
export async function deleteMessage(webhook, messageId, fetcher = fetch) {
  const response = await fetcher(`${webhook}/messages/${messageId}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Suppression Discord refusée : ${response.status}`);
}

/** Remplace l'image du message existant. Renvoie false s'il a été supprimé. */
export async function editImage(webhook, messageId, file, filename, type, fetcher = fetch) {
  const response = await fetcher(`${webhook}/messages/${messageId}`, { method: 'PATCH', body: form(file, filename, type) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Mise à jour Discord refusée : ${response.status}`);
  return true;
}
