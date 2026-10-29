'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import styles from './booking-next-steps.module.css';

const choices = [
  {
    href: '/landing/party',
    icon: '✦',
    title: 'Book a birthday party',
    description: 'Explore party dates and confirm your celebration with a $150 deposit.',
    destination: 'My Parties',
    pointer: 'Book your birthday party here!',
    className: styles.party,
  },
  {
    href: '/landing/classschedule',
    icon: '♫',
    title: 'Find your first class',
    description: 'Browse classes, add your child, and choose a spot.',
    destination: 'My Classes',
    pointer: 'Find a class for your little wanderer!',
    className: styles.classes,
  },
];

function hasSeen(key: string) {
  let canReadLocalStorage = false;
  try {
    const value = window.localStorage.getItem(key);
    canReadLocalStorage = true;
    if (value === 'seen') return true;
  } catch { /* Try the session preference next. */ }
  try { return window.sessionStorage.getItem(key) === 'seen'; } catch { return !canReadLocalStorage; }
}

function remember(key: string) {
  try { window.localStorage.setItem(key, 'seen'); } catch {
    try { window.sessionStorage.setItem(key, 'seen'); } catch { /* The guide remains available manually. */ }
  }
}

export default function BookingNextSteps({ userId }: { userId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const storageKey = `lw_booking_welcome_v1:${userId}`;

  useEffect(() => {
    if (hasSeen(storageKey)) return;
    let cancelled = false;
    // Wait for a verified customer role so staff never receive the welcome popup.
    void fetch('/api/auth/staff', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (cancelled || !result?.ok || result.is_staff !== false || hasSeen(storageKey)) return;
        dialog.current?.showModal();
        remember(storageKey);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [storageKey]);

  const open = () => {
    dialog.current?.showModal();
    remember(storageKey);
  };

  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
  };

  return (
    <>
      <section className={styles.section} aria-labelledby="booking-next-heading">
        <div className={styles.headingRow}>
          <div>
            <p className={styles.eyebrow}>Your next adventure</p>
            <h2 id="booking-next-heading">What would you like to plan?</h2>
          </div>
          <button ref={trigger} type="button" className={styles.help} onClick={open}>
            Show me around
          </button>
        </div>
        <p className={styles.intro}>Your account is ready. Choose a class or plan a birthday party to get started.</p>
        <div className={styles.grid}>
          {choices.map((choice) => (
            <Link key={choice.href} href={choice.href} className={`${styles.card} ${choice.className}`}>
              <span className={styles.icon} aria-hidden="true">{choice.icon}</span>
              <h3>{choice.title}</h3>
              <p>{choice.description}</p>
              <span className={styles.action}>{choice.destination} <span aria-hidden="true">→</span></span>
            </Link>
          ))}
        </div>
      </section>

      <dialog ref={dialog} className={styles.dialog} aria-labelledby="booking-welcome-heading" aria-describedby="booking-welcome-description">
        <div className={styles.dialogBody}>
          <button type="button" className={styles.close} aria-label="Close booking guide" onClick={close} autoFocus>×</button>
          <p className={styles.eyebrow}>Welcome to Little Wanderers</p>
          <h2 id="booking-welcome-heading">You’re in! Let’s make a plan.</h2>
          <p id="booking-welcome-description" className={styles.intro}>
            Your account is ready. Booking a class or party is a separate step — choose where you’d like to go next.
          </p>
          <div className={styles.guideGrid}>
            {choices.map((choice) => (
              <div key={choice.href} className={styles.guideChoice}>
                <p className={styles.pointer}>{choice.pointer} <span aria-hidden="true">↓</span></p>
                <Link href={choice.href} className={`${styles.card} ${choice.className}`} onClick={() => dialog.current?.close()}>
                  <span className={styles.icon} aria-hidden="true">{choice.icon}</span>
                  <h3>{choice.title}</h3>
                  <p>{choice.description}</p>
                  <span className={styles.action}>{choice.destination} <span aria-hidden="true">→</span></span>
                </Link>
              </div>
            ))}
          </div>
          <button type="button" className={styles.later} onClick={close}>I’ll explore my dashboard first</button>
          <p className={styles.footnote}>These booking buttons stay on your dashboard whenever you’re ready.</p>
        </div>
      </dialog>
    </>
  );
}
