import styles from './class-registration.module.css';

export function descriptionCopy(title: string, description: string | null) {
  if (title === 'Little Hands, Big Canvases') return {
    intro: 'A parent-and-me painting series for ages 2–4. Explore color and texture through hands-on art, and take home a new canvas each week.',
    more: 'Led by West Hartford artist Jamie Emmons of Roots & Canvas. Children use real canvas, paint, and tools designed for small hands. No art experience needed — just curiosity and a grown-up ready to create alongside them.',
  };
  const clean = (description ?? '').replace(/^Starts[^.]*\.\s*/, '').split(/Series registration terms:/i)[0]
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s+/g, ' ').trim().replace(/^Little Artists\s*[–-]\s*Art\s*&\s*Craft Class\s*/i, '');
  const sentences = (clean.replace(/\b(Ms|Mr|Mrs|Dr)\./g, '$1·').match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? []).map(sentence => sentence.replace(/\b(Ms|Mr|Mrs|Dr)·/g, '$1.').trim());
  const intro = sentences.slice(0, 2).join(' ').trim() || clean;
  return { intro, more: sentences.slice(2).join(' ').trim() };
}

export default function ClassDescription({ title, description }: { title: string; description: string | null }) {
  const copy = descriptionCopy(title, description);
  if (!copy.intro) return null;
  return <div className={styles.description}><p>{copy.intro}</p>{copy.more && <details><summary>More about this class</summary><p>{copy.more}</p></details>}</div>;
}
