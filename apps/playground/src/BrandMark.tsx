/** Streaming fragments contained by a pair of structured-data brackets. */
export function BrandMark(props: { size?: number }) {
  return (
    <svg
      width={props.size ?? 34}
      height={props.size ?? 34}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 7H7v26h5M28 7h5v26h-5" />
        <path d="M16 12h8M16 20h8M20 28h4" />
      </g>
      <path
        d="M16 28h.01"
        stroke="currentColor"
        stroke-opacity=".4"
        stroke-width="3.5"
        stroke-linecap="round"
      />
    </svg>
  );
}
