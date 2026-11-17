/** Lightweight vector artwork; stays crisp on phones and needs no image download. */
export function CyberverseBanner() {
  return (
    <svg
      className="block aspect-[8/3] w-full"
      viewBox="0 0 800 300"
      fill="none"
      role="img"
      aria-labelledby="cv-vault-title"
    >
      <title id="cv-vault-title">
        CYBERVERSE: a neon cyberpunk city with a glowing holographic core, a third-person explorer on the cyan
        path, and support for desktop and touch play
      </title>
      <defs>
        <linearGradient id="cv-vault-sky" x1="400" y1="0" x2="400" y2="300" gradientUnits="userSpaceOnUse">
          <stop stopColor="#071026" />
          <stop offset="0.6" stopColor="#10243d" />
          <stop offset="1" stopColor="#080f22" />
        </linearGradient>
        <linearGradient id="cv-vault-road" x1="400" y1="150" x2="400" y2="300" gradientUnits="userSpaceOnUse">
          <stop stopColor="#154456" />
          <stop offset="1" stopColor="#0a1429" />
        </linearGradient>
        <linearGradient id="cv-vault-tower" x1="0" y1="80" x2="0" y2="260" gradientUnits="userSpaceOnUse">
          <stop stopColor="#172b45" />
          <stop offset="1" stopColor="#081222" />
        </linearGradient>
        <radialGradient id="cv-vault-halo">
          <stop stopColor="#2dd4bf" stopOpacity="0.25" />
          <stop offset="1" stopColor="#2dd4bf" stopOpacity="0" />
        </radialGradient>
        <filter id="cv-vault-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <pattern id="cv-vault-windows" width="15" height="16" patternUnits="userSpaceOnUse">
          <path d="M4 4h4" stroke="#38bfc9" strokeOpacity="0.45" strokeWidth="2" />
        </pattern>
      </defs>

      <path fill="url(#cv-vault-sky)" d="M0 0h800v300H0z" />
      <ellipse cx="465" cy="166" rx="225" ry="135" fill="url(#cv-vault-halo)" />
      <g stroke="#50b7c4" strokeOpacity="0.15">
        <path d="M0 99h800M0 149h800M0 201h800" />
        <path d="M80 0v224M210 0v224M340 0v224M470 0v224M600 0v224M730 0v224" />
      </g>
      <circle cx="658" cy="70" r="34" stroke="#f472b6" strokeOpacity="0.35" />
      <path d="M621 70h74M658 33v74" stroke="#f472b6" strokeOpacity="0.25" />

      <g fill="#102139" stroke="#23506a" strokeWidth="1">
        <path d="M259 176V99h27v77M298 176V73h27v103M336 176v-61h26v61M371 176V89h28v87M412 176v-55h22v55M443 176V96h30v80M485 176v-61h23v61M519 176V80h31v96M558 176v-67h27v67" />
      </g>
      <path d="m348 171-247 129h598L482 171z" fill="url(#cv-vault-road)" />
      <g stroke="#32d9d0" strokeOpacity="0.55">
        <path d="M348 171 101 300M378 171l-99 129M445 171l80 129M482 171l217 129M291 201h242M222 237h372M153 273h506" />
      </g>
      <path d="m407 184-10 20m-7 14-16 32m-9 18-16 32" stroke="#ffcf7b" strokeWidth="3" />
      <path d="m424 184 6 20m4 14 10 32m5 18 10 32" stroke="#ffcf7b" strokeWidth="3" />

      <g fill="url(#cv-vault-tower)" stroke="#2a526d">
        <path d="M0 126 84 98v162L0 300z" />
        <path d="m84 98 31 19v132l-31 11z" fill="#0b192d" />
        <path d="m129 111 74-24v132l-74 30z" />
        <path d="m203 87 26 18v105l-26 9z" fill="#0b192d" />
        <path d="m240 136 54-15v70l-54 23z" />
        <path d="m570 102 60-19v142l-60-28z" />
        <path d="m630 83 30 18v139l-30-15z" fill="#091629" />
        <path d="m681 104 69-31v198l-69-31z" />
        <path d="m750 73 50 34v193l-50-29z" fill="#0a1629" />
      </g>
      <g fill="url(#cv-vault-windows)">
        <path d="M8 140 72 119v127L8 275zM141 125l50-18v95l-50 22zM250 146l34-10v48l-34 16zM580 115l39-14v106l-39-18zM693 121l44-20v145l-44-19z" />
      </g>
      <g strokeWidth="3">
        <path d="M0 127 84 99v161M129 112l74-24v131M570 103l60-19v141" stroke="#35e4d6" />
        <path d="M681 105 750 74v197M84 260l31-11M203 219l26-9" stroke="#ec5ba7" />
        <path d="m17 184 46-15m79-22 39-13m519 26 28-12" stroke="#ffcc72" />
      </g>
      <path d="m20 188 41-15v28l-41 17z" fill="#0e3848" stroke="#2dd4bf" />
      <text x="27" y="205" fill="#7af4e4" fontSize="12" fontFamily="monospace" transform="rotate(-19 27 205)">
        01
      </text>
      <path d="m694 171 34-14v31l-34 14z" fill="#43203e" stroke="#f472b6" />

      <ellipse cx="465" cy="222" rx="50" ry="13" fill="#2dd4bf" opacity="0.12" />
      <ellipse cx="465" cy="221" rx="34" ry="9" stroke="#39e6d7" strokeOpacity="0.65" />
      <path d="m449 214 16-5 16 5v8l-16 6-16-6z" fill="#18394b" stroke="#67e8e1" />
      <path d="M465 159v48" stroke="#44e7db" strokeOpacity="0.6" strokeDasharray="3 4" />
      <g filter="url(#cv-vault-glow)" stroke="#5eead4" strokeWidth="4">
        <path d="m465 125 20 24-20 25-20-25z" />
      </g>
      <path
        d="m465 125 20 24-20 25-20-25z"
        fill="#133f50"
        fillOpacity="0.8"
        stroke="#8af9e7"
        strokeWidth="1.5"
      />
      <path d="m445 149 20 7 20-7m-20-24v49" stroke="#63e8dd" />
      <ellipse cx="465" cy="150" rx="34" ry="9" stroke="#ee7dc2" transform="rotate(-25 465 150)" />

      <path d="M24 24h34M24 24v15" stroke="#44dfcf" strokeWidth="2" />
      <text
        x="34"
        y="67"
        fill="#f1fbff"
        fontSize="37"
        fontWeight="700"
        letterSpacing="4"
        fontFamily="Arial, sans-serif"
      >
        CYBERVERSE
      </text>
      <text x="36" y="88" fill="#67e8d9" fontSize="10" letterSpacing="3" fontFamily="monospace">
        LEARN. DECODE. EXPLORE.
      </text>
      <path d="M34 105h151" stroke="#ec5ba7" strokeWidth="2" />
      <text x="35" y="280" fill="#96c6d1" fontSize="10" letterSpacing="2" fontFamily="monospace">
        BINARY CITY / SECTOR 01
      </text>

      {/* Third-person runner from the 3D game: armor, cyan visor, amber shoulder lights. */}
      <g transform="translate(404 228)">
        <ellipse cx="11" cy="47" rx="15" ry="3.5" fill="#2dd4bf" opacity="0.25" />
        <path d="M3 28h7v18H3zM12 28h7v18h-7z" fill="#111f2b" stroke="#2a526d" />
        <path d="M0 10h22v19H0z" fill="#243a4a" stroke="#3b6274" />
        <path d="M4 0h14v11H4z" fill="#243a4a" stroke="#3b6274" />
        <path d="M5 4h12" stroke="#5cebd5" strokeWidth="2.5" />
        <path d="M5 4h12" stroke="#5cebd5" strokeWidth="6" strokeOpacity="0.25" />
        <path d="M-4 12h4v12h-4zM22 12h4v12h-4z" fill="#243a4a" />
        <path d="M-3 17h2M23 17h2" stroke="#ffbf77" strokeWidth="2" />
        <path d="M4 15h14" stroke="#5cebd5" strokeOpacity="0.8" />
      </g>

      <g transform="translate(588 254)">
        <path d="M0 0h176v24H0z" fill="#081427" fillOpacity="0.88" stroke="#2dd4bf" strokeOpacity="0.6" />
        <circle cx="12" cy="12" r="3" fill="#5eead4" />
        <text x="22" y="16" fill="#c9fbf4" fontSize="9.5" letterSpacing="1.5" fontFamily="monospace">
          DESKTOP
        </text>
        <text x="74" y="16" fill="#f472b6" fontSize="9.5" fontFamily="monospace">
          +
        </text>
        <circle cx="90" cy="12" r="3" fill="#f472b6" />
        <text x="100" y="16" fill="#fbd5ea" fontSize="9.5" letterSpacing="1.5" fontFamily="monospace">
          TOUCH
        </text>
        <text x="142" y="16" fill="#ffcf7b" fontSize="9.5" fontFamily="monospace">
          3D
        </text>
      </g>
      <path d="M762 279h15v-15" stroke="#44dfcf" strokeWidth="2" />
    </svg>
  );
}
