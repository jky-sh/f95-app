/**
 * The F95 lockup redrawn as SVG from the app icon's geometry (512 px grid),
 * split into the pieces the Big Picture intro animates one by one: the rules
 * and "ZONE / 002" label, the blocky F, the red 9, the 5 drawn segment by
 * segment, and the play arrow running along the bottom rule.
 */

const INK = '#f5f3ef';
const RED = '#e23a2e';
const GREY = '#7a7a79';

/** The 9: rounded bowl with its hole, running into the stem. */
const NINE =
  'M179 139H287Q297 139 297 149V372H256V271H179Q169 271 169 261V149Q169 139 179 139Z' +
  'M200 169V240H266V169Z';

export function BpLogo({ className, label = 'ZONE / 002' }: { className?: string; label?: string }) {
  return (
    <svg
      className={className ? `bp-logo ${className}` : 'bp-logo'}
      viewBox="40 56 432 400"
      role="img"
      aria-label="F95"
    >
      <g className="bp-lg-top">
        <rect className="bp-lg-rule bp-lg-rule--top" x="57" y="77.5" width="101" height="4" fill={GREY} />
        <text
          className="bp-lg-label"
          x="171"
          y="86.5"
          fill={GREY}
          textLength="188"
          lengthAdjust="spacing"
        >
          {label}
        </text>
        <rect className="bp-lg-dash bp-lg-dash--top" x="423" y="77" width="32" height="4.5" fill={RED} />
      </g>

      <g className="bp-lg-f" fill={INK}>
        <rect className="bp-lg-f-stem" x="57" y="138" width="40" height="234" />
        <path className="bp-lg-f-top" d="M57 138H168L153 178H57Z" />
        <rect className="bp-lg-f-mid" x="57" y="226" width="76" height="35" />
      </g>

      <path className="bp-lg-9" d={NINE} fill={RED} fillRule="evenodd" />

      <g className="bp-lg-5" fill={INK}>
        <rect className="bp-lg-5-a" x="328" y="139" width="127" height="35" />
        <rect className="bp-lg-5-b" x="328" y="173" width="35" height="38" />
        <rect className="bp-lg-5-c" x="328" y="210" width="127" height="35" />
        <rect className="bp-lg-5-d" x="420" y="244" width="35" height="95" />
        <path className="bp-lg-5-e" d="M328 338H455V351Q455 372 434 372H328Z" />
      </g>

      <g className="bp-lg-bottom">
        <rect className="bp-lg-rule bp-lg-rule--bottom" x="57" y="425" width="311" height="4.5" fill={GREY} />
        <path className="bp-lg-play" d="M395 415L427 428.5L395 442Z" fill={RED} />
        <rect className="bp-lg-dash bp-lg-dash--bottom" x="441" y="425" width="14" height="4.5" fill={RED} />
      </g>
    </svg>
  );
}

/** Just the letters, for the top bar. */
export function BpMark({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `bp-mark ${className}` : 'bp-mark'}
      viewBox="52 133 408 244"
      role="img"
      aria-label="F95"
    >
      <g fill={INK}>
        <rect x="57" y="138" width="40" height="234" />
        <path d="M57 138H168L153 178H57Z" />
        <rect x="57" y="226" width="76" height="35" />
        <path d="M328 139H455V174H363V210H455V351Q455 372 434 372H328V338H420V245H328Z" />
      </g>
      <path d={NINE} fill={RED} fillRule="evenodd" />
    </svg>
  );
}
