/**
 * Loose "same song" key used to avoid playing one song twice in a session when YouTube
 * serves it under different uploads (official video, lyric video, audio, live...).
 * "Marc Anthony - Vivir Mi Vida (Official Video)" and "Vivir Mi Vida [Letra]" → "vivirmivida".
 */
export function looseSongKey(title: string): string {
  let t = title.toLowerCase();
  if (t.includes('|')) t = t.split('|')[0];
  t = t.replace(/\(.*?\)|\[.*?\]/g, ' ');
  if (t.includes(' - ')) t = t.split(' - ').slice(1).join(' ') || t;
  t = t
    .replace(/\b(official|oficial|music|video|videoclip|audio|lyrics?|letra|visualizer|hd|4k|remaster(ed)?)\b/g, ' ')
    .replace(/\b(ft|feat)\.?\s.*$/g, ' ');
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}
