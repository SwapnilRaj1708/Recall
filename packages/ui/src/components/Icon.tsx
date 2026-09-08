import type { SVGProps } from 'react';

/**
 * A deliberately tiny icon set.
 *
 * Inline SVG rather than an icon font or a dependency: there are eleven of
 * them, they must inherit `currentColor` so they follow the theme, and the
 * widget should not pay for a webfont it uses twice.
 */

export type IconName =
  | 'check'
  | 'plus'
  | 'close'
  | 'trash'
  | 'undo'
  | 'more'
  | 'search'
  | 'settings'
  | 'cloud'
  | 'cloud-off'
  | 'pin'
  | 'panel'
  | 'grip'
  | 'alert'
  | 'inbox'
  | 'google';

const PATHS: Record<Exclude<IconName, 'google'>, string> = {
  check: 'M3.5 8.5l3 3 6-7',
  plus: 'M8 3.5v9M3.5 8h9',
  close: 'M4 4l8 8M12 4l-8 8',
  trash: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8M6.8 7v3.2M9.2 7v3.2',
  undo: 'M6 4.5L3.5 7 6 9.5M3.5 7h5.2a3.3 3.3 0 010 6.6H6',
  more: 'M8 4.2h.01M8 8h.01M8 11.8h.01',
  search: 'M7.2 11.4a4.2 4.2 0 100-8.4 4.2 4.2 0 000 8.4zM10.4 10.4l2.6 2.6',
  settings:
    'M8 10a2 2 0 100-4 2 2 0 000 4zM12.9 9.4l1 .8-1 1.7-1.2-.4a4 4 0 01-1.2.7L10.3 14H8.4L8.2 12.2a4 4 0 01-1.2-.7l-1.2.4-1-1.7 1-.8a4 4 0 010-1.4l-1-.8 1-1.7 1.2.4a4 4 0 011.2-.7L8.4 3h1.9l.2 1.8a4 4 0 011.2.7l1.2-.4 1 1.7-1 .8a4 4 0 010 1.4z',
  cloud: 'M4.6 12.5a2.6 2.6 0 01-.3-5.2 3.6 3.6 0 016.9-1 2.9 2.9 0 01.3 5.8z',
  'cloud-off': 'M2.5 2.5l11 11M4.6 12.5a2.6 2.6 0 01-.3-5.2 3.6 3.6 0 011-2M8.2 4.4a3.6 3.6 0 013 2.9 2.9 2.9 0 011.3 5',
  pin: 'M6.2 2.8h3.6l-.5 3.4 2 2.2H4.7l2-2.2-.5-3.4zM8 8.4v4.8',
  // A screen with a small panel sitting on it: the desktop widget. Kept to
  // two shapes because anything finer turns to mud at 14px.
  panel:
    'M2.6 3.4h10.8a1.2 1.2 0 011.2 1.2v6.8a1.2 1.2 0 01-1.2 1.2H2.6a1.2 1.2 0 01-1.2-1.2V4.6a1.2 1.2 0 011.2-1.2zM8.7 5.9h3.5v4.2H8.7z',
  grip: 'M6.2 4.5h.01M9.8 4.5h.01M6.2 8h.01M9.8 8h.01M6.2 11.5h.01M9.8 11.5h.01',
  alert: 'M8 5.5v3.2M8 11.2h.01M7 2.9L1.9 12a1.1 1.1 0 001 1.7h10.2a1.1 1.1 0 001-1.7L9 2.9a1.1 1.1 0 00-2 0z',
  inbox:
    'M2.5 9.5h3l1 2h3l1-2h3M3.6 3.5h8.8l1.1 6v3a1 1 0 01-1 1H3.5a1 1 0 01-1-1v-3z',
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  if (name === 'google') return <GoogleMark size={size} {...rest} />;

  const isDots = name === 'more' || name === 'grip';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} strokeWidth={isDots ? 2 : undefined} />
    </svg>
  );
}

/** Google's mark keeps its own colours; recolouring it breaks their brand terms. */
function GoogleMark({ size = 16, ...rest }: Omit<IconProps, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 009 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.41 5.41 0 010-3.42V4.96H.96a9 9 0 000 8.08l3-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
