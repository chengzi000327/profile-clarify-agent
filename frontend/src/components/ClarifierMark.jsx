import React from 'react';

export default function ClarifierMark({ size = 32, plate = false }) {
  return (
    <span className={`clarifier-mark ${plate ? 'with-plate' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 40 40" role="img">
        <path className="mark-blue" d="M18.1 7.5h-6.3A5.8 5.8 0 0 0 6 13.3v6.3a5.8 5.8 0 0 0 4.4 5.6L7.6 29l6.3-3.6h4.2" />
        <path className="mark-cyan" d="M21.9 7.5h6.3a5.8 5.8 0 0 1 5.8 5.8v6.3a5.8 5.8 0 0 1-4.4 5.6l2.8 3.8-6.3-3.6h-4.2" />
        <path className="mark-focus" d="M15.8 14.2h-2.1v2.2M24.2 14.2h2.1v2.2M15.8 22.6h-2.1v-2.2M24.2 22.6h2.1v-2.2" />
        <circle className="mark-dot" cx="20" cy="18.4" r="2.2" />
      </svg>
    </span>
  );
}
