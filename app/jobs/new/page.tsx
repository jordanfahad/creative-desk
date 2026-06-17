import Link from "next/link";
import { createJob } from "@/lib/actions";

export const dynamic = "force-dynamic";

const INTENTS = [
  { value: "optimize", title: "Optimize existing", desc: "Upload a photo or video — fix it on-brand and size it for every channel." },
  { value: "create", title: "Create new", desc: "Describe it — generate it on-brand for every channel." },
];
const MEDIA = [
  { value: "image", title: "Image", desc: "Stills" },
  { value: "video", title: "Video", desc: "Clips" },
];

export default function NewJobPage() {
  return (
    <main>
      <h1>New job</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Pick what you’re doing — you’ll add creatives, channels, and generate on the
        next screen.
      </p>

      <form action={createJob}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>1 · What do you want to do?</h3>
          <div className="grid cols-2">
            {INTENTS.map((o, i) => (
              <label key={o.value} className="choice">
                <input type="radio" name="intent" value={o.value} defaultChecked={i === 0} />
                <div>
                  <div className="choice-title">{o.title}</div>
                  <div className="small muted">{o.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>2 · Image or video?</h3>
          <div className="grid cols-2">
            {MEDIA.map((o, i) => (
              <label key={o.value} className="choice">
                <input type="radio" name="media" value={o.value} defaultChecked={i === 0} />
                <div>
                  <div className="choice-title">{o.title}</div>
                  <div className="small muted">{o.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>3 · Name it</h3>
          <input type="text" name="title" placeholder="e.g. Reception — channel set" required />
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn">
              Create job →
            </button>
            <Link href="/" className="btn secondary" style={{ marginLeft: 10 }}>
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </main>
  );
}
