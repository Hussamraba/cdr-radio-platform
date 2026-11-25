import { Pause, Play } from 'lucide-react'
import { useState } from 'react'
import studio from '../assets/broadcast-studio.svg?no-inline'
import { useMotionAllowed } from '../hooks/preferences'

export function HeroArtwork() {
  const motionAllowed = useMotionAllowed()
  const [paused, setPaused] = useState(false)
  const action = paused ? 'Resume background motion' : 'Pause background motion'

  return (
    <>
      <div className="hero-artwork" aria-hidden="true" data-motion={motionAllowed} data-paused={paused}>
        <img src={studio} alt="" width={720} height={420} />
      </div>
      {motionAllowed && <button type="button" className="icon-button hero-motion" onClick={() => setPaused(value => !value)}
        aria-label={action} title={action}>
        {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
      </button>}
    </>
  )
}
