'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from './pastel.module.css';

export default function PublicMoreMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => menu.current?.removeAttribute('open');

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (menu.current?.open) menu.current.querySelector('summary')?.focus();
        close();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <details ref={menu} className={styles.more}>
      <summary>More</summary>
      <div>
        <Link href="/gift-cards" onClick={close}>Gift cards</Link>
        <Link href="/cafe" onClick={close}>Cafe</Link>
        <Link href="/faq" onClick={close}>FAQ</Link>
        <Link href="/contact" onClick={close}>Contact</Link>
      </div>
    </details>
  );
}
