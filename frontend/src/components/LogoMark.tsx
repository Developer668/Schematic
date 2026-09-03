export default function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      width="32"
      height="32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={`logo-mark ${className}`.trim()}
    >
      <defs>
        <linearGradient id="schemLogoBody" x1="60" y1="56" x2="200" y2="200" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3E4757" />
          <stop offset="1" stopColor="#242A35" />
        </linearGradient>
        <linearGradient id="schemLogoPin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#C6CDD8" />
        </linearGradient>
        <linearGradient id="schemLogoFold" x1="140" y1="52" x2="204" y2="146" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5C94FF" />
          <stop offset="1" stopColor="#1D5BEF" />
        </linearGradient>
      </defs>

      {/* chip body with folded corner cut */}
      <path
        d="M88 56 H146 L200 112 V168 Q200 200 168 200 H88 Q56 200 56 168 V88 Q56 56 88 56 Z"
        fill="url(#schemLogoBody)"
        stroke="#1B202A"
        strokeWidth="2"
      />

      {/* pin bases */}
      <g fill="#2A313D">
        <rect x="88" y="44" width="16" height="14" rx="3" />
        <rect x="120" y="44" width="16" height="14" rx="3" />
        <rect x="152" y="44" width="16" height="14" rx="3" />
        <rect x="88" y="198" width="16" height="14" rx="3" />
        <rect x="120" y="198" width="16" height="14" rx="3" />
        <rect x="152" y="198" width="16" height="14" rx="3" />
        <rect x="44" y="88" width="14" height="16" rx="3" />
        <rect x="44" y="120" width="14" height="16" rx="3" />
        <rect x="44" y="152" width="14" height="16" rx="3" />
        <rect x="198" y="88" width="14" height="16" rx="3" />
        <rect x="198" y="120" width="14" height="16" rx="3" />
        <rect x="198" y="152" width="14" height="16" rx="3" />
      </g>

      {/* pin capsules */}
      <g fill="url(#schemLogoPin)">
        <rect x="83" y="22" width="26" height="26" rx="13" />
        <rect x="115" y="22" width="26" height="26" rx="13" />
        <rect x="147" y="22" width="26" height="26" rx="13" />
        <rect x="83" y="208" width="26" height="26" rx="13" />
        <rect x="115" y="208" width="26" height="26" rx="13" />
        <rect x="147" y="208" width="26" height="26" rx="13" />
        <rect x="22" y="83" width="26" height="26" rx="13" />
        <rect x="22" y="115" width="26" height="26" rx="13" />
        <rect x="22" y="147" width="26" height="26" rx="13" />
        <rect x="208" y="83" width="26" height="26" rx="13" />
        <rect x="208" y="115" width="26" height="26" rx="13" />
        <rect x="208" y="147" width="26" height="26" rx="13" />
      </g>

      {/* die cavity */}
      <rect x="90" y="90" width="76" height="76" rx="18" fill="#0A0D12" stroke="#EFF2F6" strokeWidth="7" />

      {/* light seam between body and fold */}
      <path d="M144 55 L186 139" stroke="#E6EBF2" strokeWidth="4" strokeLinecap="round" />

      {/* blue folded corner */}
      <path d="M140 52 H168 Q204 52 204 88 V146 H190 Q184 146 184 140 V136 Z" fill="url(#schemLogoFold)" />
      <path d="M140 52 L184 136 L184 116 L154 52 Z" fill="#1B4FD8" opacity="0.5" />
    </svg>
  );
}
