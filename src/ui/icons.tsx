/** Small line icons drawn in the current text colour. */
const PATHS = {
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
      <path d="M9 7.5h6" />
    </>
  ),
  cog: (
    <>
      <path d="M19.3 10 L21.9 10.5 L21.9 13.5 L19.3 14 L18.6 15.7 L20.1 17.9 L17.9 20.1 L15.7 18.6 L14 19.3 L13.5 21.9 L10.5 21.9 L10 19.3 L8.3 18.6 L6.1 20.1 L3.9 17.9 L5.4 15.7 L4.7 14 L2.1 13.5 L2.1 10.5 L4.7 10 L5.4 8.3 L3.9 6.1 L6.1 3.9 L8.3 5.4 L10 4.7 L10.5 2.1 L13.5 2.1 L14 4.7 L15.7 5.4 L17.9 3.9 L20.1 6.1 L18.6 8.3 Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="line-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
