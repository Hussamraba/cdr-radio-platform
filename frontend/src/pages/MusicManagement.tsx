import { Headphones, Library, ListMusic, Radio, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeading, Reveal, SectionCard } from '../components/ui'

export function MusicManagement() {
  return (
    <div className="page">
      <Reveal>
        <PageHeading title="Music Management" description="One central broadcast for every Ghmaas Baladi branch." />
      </Reveal>
      <div className="music-management-layout">
        <Reveal delay={0.035}>
          <SectionCard title="Shared broadcast" icon={Radio}>
            <ul className="music-flow" role="list">
              <li><Library size={19} aria-hidden="true" /><div><h3>Central library</h3><p>Approved administrators upload music to one station library.</p></div></li>
              <li><ListMusic size={19} aria-hidden="true" /><div><h3>Main Rotation</h3><p>AutoDJ broadcasts the tracks assigned to this shared playlist.</p></div></li>
              <li><Headphones size={19} aria-hidden="true" /><div><h3>Branch Player</h3><p>Every branch hears the same stream. Branch players are listening-only.</p></div></li>
            </ul>
            <Link className="button button-primary" to="/player"><Headphones size={17} aria-hidden="true" /> Open Branch Player</Link>
          </SectionCard>
        </Reveal>
        <Reveal delay={0.07}>
          <SectionCard title="Operator workflow" icon={ShieldCheck}>
            <p className="section-description">Music changes require an approved administrator account and access from an authorized Tailscale device.</p>
            <ol className="music-workflow">
              <li><h3>Connect and sign in</h3><p>Connect to Tailscale. Open the private Ghmaas Admin Panel at the address provided to you and sign in.</p></li>
              <li><h3>Upload approved audio</h3><p>Open Music Library to review the catalog, or use Upload Music to add approved MP3 or PCM WAV files.</p></li>
              <li><h3>Verify and assign tracks</h3><p>Confirm the uploaded record in Music Library, then choose <strong>Add to Main Rotation</strong> for each track you want on air.</p></li>
              <li><h3>Monitor the broadcast</h3><p>Check the current and upcoming tracks on the <Link to="/">Dashboard</Link>.</p></li>
            </ol>
          </SectionCard>
        </Reveal>
      </div>
    </div>
  )
}
