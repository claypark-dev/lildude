import type { FC } from 'react'

interface WaveDividerProps {
  flip?: boolean
}

export const WaveDivider: FC<WaveDividerProps> = ({ flip = false }) => {
  return (
    <div
      className="w-full overflow-hidden leading-none"
      style={{
        transform: flip ? 'scaleY(-1)' : undefined,
      }}
    >
      <svg
        viewBox="0 0 1440 60"
        preserveAspectRatio="none"
        className="w-full block"
        style={{ height: '60px' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0,40 C240,0 480,60 720,30 C960,0 1200,50 1440,20 L1440,60 L0,60 Z"
          fill="#3b82f6"
          fillOpacity="0.15"
        />
        <path
          d="M0,45 C360,10 720,55 1080,25 C1260,10 1380,35 1440,30 L1440,60 L0,60 Z"
          fill="#3b82f6"
          fillOpacity="0.08"
        />
      </svg>
    </div>
  )
}
