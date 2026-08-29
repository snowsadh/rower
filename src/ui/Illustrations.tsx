// Small, native SVG illustrations: spreadsheet cells doing the actual work.
export function CellScout({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 260 230" fill="none" role="img" aria-label="A cheerful spreadsheet cell with a magnifying glass, finding the right answer">
    <ellipse cx="129" cy="210" rx="87" ry="9" fill="#203d34" opacity=".09"/>
    <g stroke="#243c35" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M87 170 77 203 59 207M139 177 149 204 170 204"/>
      <path d="M48 103C25 107 28 135 47 139M157 115 181 105"/>
      <path d="m69 46 100 13-13 120-111-14z" fill="#facf5b"/>
      <path d="m69 46 100 13-3 24L65 70z" fill="#ffeaa8"/>
      <path d="m64 92 93 12M60 119l94 11M86 78l-10 75M115 81l-10 76M143 85l-8 76" stroke="#b38f3d" strokeWidth="1.5"/>
      <ellipse cx="92" cy="110" rx="4" ry="7" fill="#243c35" stroke="none"/>
      <ellipse cx="125" cy="115" rx="4" ry="7" fill="#243c35" stroke="none"/>
      <path d="M94 132q12 13 23 3"/>
      <path d="m179 108 25 38" strokeWidth="10"/>
      <circle cx="170" cy="84" r="29" fill="#c7e8e9" fillOpacity=".9" strokeWidth="5"/>
      <path d="m160 71 15-4M155 81l26-6" stroke="white" strokeWidth="4"/>
      <path d="m192 32 8-9m8 27 13-2"/>
      <path d="m36 52 5-11 5 11 11 5-11 5-5 11-5-11-11-5z" fill="#b9bcf6" strokeWidth="2"/>
    </g>
    <ellipse cx="80" cy="126" rx="7" ry="4" fill="#f2967d"/>
    <ellipse cx="134" cy="133" rx="7" ry="4" fill="#f2967d"/>
  </svg>;
}

export function CellPals({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 310 225" fill="none" role="img" aria-label="Two friendly spreadsheet columns joining hands, with new answers neatly added">
    <ellipse cx="159" cy="207" rx="118" ry="9" fill="#243c35" opacity=".08"/>
    <g stroke="#243c35" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="m70 167-7 35H46m66-31 5 30h16M207 173l-6 29h-17m55-33 7 31h19"/>
      <path d="M55 115q-33 2-28-28m113 32q22 34 43 3m74-9q34-2 29-29"/>
      <path d="m62 56 87 7-9 114-89-8z" fill="#b9bcf6"/>
      <path d="m62 56 87 7-2 22-87-7z" fill="#dedfff"/>
      <path d="m60 101 85 7m-87 24 84 7" stroke="#878bcc" strokeWidth="1.5"/>
      <path d="m178 51 79-8 13 125-87 9z" fill="#a8d8b8"/>
      <path d="m178 51 79-8 3 24-80 8z" fill="#d3eedc"/>
      <path d="m184 100 78-8m-75 38 78-9" stroke="#6caa81" strokeWidth="1.5"/>
      <path d="M86 109v8m30-5v8m-30 17q10 10 21 2M204 106v8m27-10v8m-22 22q12 9 19-3"/>
      <path d="m188 23 8-9m16 8V8m16 16 9-9" stroke="#eaa847"/>
      <path d="m213 69 6 6 11-14" stroke="#37754c"/>
    </g>
    <ellipse cx="76" cy="127" rx="6" ry="4" fill="#fb977f"/>
    <ellipse cx="126" cy="132" rx="6" ry="4" fill="#fb977f"/>
    <ellipse cx="199" cy="124" rx="6" ry="4" fill="#fb977f"/>
    <ellipse cx="239" cy="119" rx="6" ry="4" fill="#fb977f"/>
  </svg>;
}
