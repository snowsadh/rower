import { useEffect, useRef, useState } from "react";
import { CellPals, CellScout } from "./Illustrations";

export function Wordmark() {
  return <span className="wordmark">rower<span className="wordmark-period">.</span></span>;
}

export function Arrow() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>;
}

const examples = [
  { label: "Find websites", file: "good-companies.xlsx", prompt: "Find each company’s official website", input: "company", output: "official_website", rows: [["Patagonia", "patagonia.com"], ["Oatly", "oatly.com"], ["Are.na", "are.na"], ["Headspace", "headspace.com"]] },
  { label: "Compare values", file: "same-but-different.csv", prompt: "Do these job titles mean the same thing?", input: "job titles", output: "same_role", rows: [["SWE / Software engineer", "Yes"], ["Designer / Accountant", "No"], ["PM / Product manager", "Yes"], ["CEO / Chief executive", "Yes"]] },
  { label: "Sort feedback", file: "little-things-to-fix.csv", prompt: "Give each piece of feedback a category", input: "feedback", output: "category", rows: [["Love the new colours!", "Design"], ["Where’s my package?", "Delivery"], ["Make a smaller size?", "Product"], ["You made my day.", "Happy customer"]] }
];

function RowingFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "100px" });
    observer.observe(element);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPlaying(!media.matches);
    const change = () => setPlaying(!media.matches);
    media.addEventListener("change", change);
    return () => { observer.disconnect(); media.removeEventListener("change", change); };
  }, []);
  useEffect(() => {
    if (playing && visible) void video.current?.play().catch(() => setPlaying(false));
    else video.current?.pause();
  }, [playing, visible]);
  return <figure className="rowing-film">
    <video ref={video} src={visible ? "/media/rowing.mp4" : undefined} poster="/media/rowing-poster.jpg" loop muted playsInline preload="none" aria-label="An illustrated rowboat drifting across clear turquoise water"/>
    <button className="film-control" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause rowing animation" : "Play rowing animation"}>{playing ? "Ⅱ" : "▷"} <span>{playing ? "Pause" : "Play"}</span></button>
    <figcaption>Less scrolling. More rowing.</figcaption>
  </figure>;
}

export function Landing() {
  const [example, setExample] = useState(0);
  const [filled, setFilled] = useState(true);
  const current = examples[example];
  return <div className="landing">
    <a className="skip-link" href="#landing-main">Skip to content</a>
    <header className="site-nav">
      <a href="#" aria-label="Rower home"><Wordmark/></a>
      <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#possibilities">What can I do?</a><a className="nav-start" href="#workspace">Start rowing <Arrow/></a></nav>
    </header>
    <main id="landing-main" className="landing-main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="workbook-title"><span><span className="tiny-grid" aria-hidden="true"/> a-little-less-busy.xlsx</span><span className="workbook-tag">A fresh way to spreadsheet</span><span aria-hidden="true">− &nbsp; □ &nbsp; ×</span></div>
        <div className="formula-bar"><span>A1</span><span className="formula-fx">ƒx</span><span>= LESS_BUSYWORK + MORE_POSSIBILITIES</span></div>
        <div className="column-letters" aria-hidden="true"><span/><span>A</span><span>B</span><span>C</span><span>D</span><span>E</span><span>F</span></div>
        <div className="hero-sheet">
          <div className="row-numbers" aria-hidden="true">{[1,2,3,4,5,6,7,8,9,10].map(n => <span key={n}>{n}</span>)}</div>
          <div className="hero-copy">
            <p className="little-label"><span className="status-dot"/> Your spreadsheet’s new little helper</p>
            <h1 id="hero-title">Goodbye,<br/>busywork.<br/><span className="selected-word">Hello, Rower.<i aria-hidden="true"/></span></h1>
            <p className="hero-description">Find the websites. Match the titles. Sort the feedback.<br className="desktop-break"/> Tell Rower what you need, and let your rows do a little more.</p>
            <div className="hero-action"><a className="start-button" href="#workspace">Start rowing <Arrow/></a><span>No signup.<br/>Just your sheet + your model key.</span></div>
          </div>
          <div className="hero-demo">
            <div className="demo-sticky">That column you’ve<br/>been putting off? <span aria-hidden="true">↴</span></div>
            <div className="example-sheet">
              <div className="example-title"><span className="tiny-grid" aria-hidden="true"/>{current.file}<span className="example-badge">Example</span></div>
              <div className="example-prompt"><span>↳</span> {current.prompt}</div>
              <table aria-label="Illustrative spreadsheet example"><thead><tr><th>#</th><th>{current.input}</th><th>{current.output} <span>↗</span></th></tr></thead><tbody>{current.rows.map(([input, output], i) => <tr key={input}><td>{i + 1}</td><td>{input}</td><td className={filled ? "example-result" : "example-pending"}>{filled ? <><span className="result-check">✓</span>{output}</> : "Ready to fill…"}</td></tr>)}</tbody></table>
              <div className="example-footer"><span aria-live="polite">{filled ? "✓ 4 little jobs, done." : "4 rows, ready to go."}</span><button onClick={() => setFilled(!filled)}>{filled ? "Reset example" : "Fill the column"} <Arrow/></button></div>
            </div>
            <div className="demo-switcher" role="group" aria-label="Choose an example">{examples.map((item, i) => <button key={item.label} aria-pressed={i === example} onClick={() => { setExample(i); setFilled(true); }}>{item.label}</button>)}</div>
            <CellScout className="hero-scout"/>
            <span className="scout-caption">on the case!</span>
          </div>
        </div>
        <div className="workbook-bottom"><span aria-hidden="true">‹ &nbsp; ›</span><span className="sheet-tab">Sheet 1: a better day</span><span className="workbook-bottom-note">Made for .xlsx & .csv</span><span>100%</span></div>
      </section>

      <section className="how-section" id="how-it-works" aria-labelledby="how-title">
        <div className="section-intro"><p className="little-label">A familiar sheet. A new superpower.</p><h2 id="how-title">From “I’ll do it later”<br/>to “oh, it’s done.”</h2></div>
        <ol className="how-steps">
          <li><span className="step-tile tile-lilac">1</span><h3>Bring your rows</h3><p>Open an Excel or CSV file. Choose the columns Rower should read.</p></li>
          <li><span className="step-tile tile-peach">2</span><h3>Give them a job</h3><p>Pick a task or write your own. Add your model key and define the answers you want.</p></li>
          <li><span className="step-tile tile-yellow">3</span><h3>Check, then let it row</h3><p>Try three rows first. Happy with the results? Run the rest and export your sheet.</p></li>
        </ol>
      </section>

      <section className="possibilities" id="possibilities" aria-labelledby="possibilities-title">
        <div className="possibilities-art"><span className="small-note">Your columns, making friends.</span><CellPals/><div className="column-chips"><span>your original data</span><span>+ the missing pieces</span></div></div>
        <div className="possibilities-copy"><p className="little-label">Not every task needs another tab</p><h2 id="possibilities-title">One sheet.<br/>Lots of possibilities.</h2><p>Research a list of companies, compare two messy columns, or turn a pile of feedback into something useful. You set the task. Rower adds the answers.</p><div className="task-tags"><span>Website research</span><span>Semantic matching</span><span>Classification</span><span>Your own idea ↗</span></div><a className="text-link" href="#workspace">Give your rows a job <Arrow/></a></div>
      </section>

      <section className="slow-section" aria-labelledby="slow-title">
        <div className="slow-copy"><p className="little-label">A little help goes a long way</p><h2 id="slow-title">You steer.<br/>Rower does<br/>the legwork.</h2><p>You choose the model, the instructions, and the pace. Pause after a batch, review the results, and take your finished spreadsheet with you.</p><div className="simple-promise"><span>↗</span><p><strong>Your sheet stays yours.</strong><br/>Only selected cells go to your chosen provider, through Rower. Your key and results stay in this tab’s memory; export before you leave.</p></div></div>
        <RowingFilm/>
      </section>

      <section className="last-call"><span className="last-call-cell" aria-hidden="true">✓</span><div><p className="little-label">There’s a better way to spend your afternoon.</p><h2>Let’s get those rows moving.</h2></div><a className="start-button" href="#workspace">Start rowing <Arrow/></a></section>
      <section className="faq" aria-labelledby="faq-title"><h2 id="faq-title">A few things<br/>you might wonder.</h2><div><details><summary>Do I need an account?<span>+</span></summary><p>No Rower account or login. Open the workspace, add your file, and connect a model using your own provider API key.</p></details><details><summary>Which models can I use?<span>+</span></summary><p>OpenAI, Anthropic, OpenRouter, and remote OpenAI-compatible services. Web research depends on the provider and model you choose.</p></details><details><summary>What does it cost?<span>+</span></summary><p>Rower uses your own API key. Your provider charges for model requests and any web searches. Try three rows first and check your provider’s usage before starting a large run.</p></details><details><summary>What happens if I close the tab?<span>+</span></summary><p>Your key and results are forgotten. Export your completed rows before refreshing or closing the tab. An active provider request may still incur a charge if you cancel it.</p></details></div></section>
    </main>
    <footer className="site-footer"><a href="#" aria-label="Rower home"><Wordmark/></a><p>A little less busywork. A little more possibility.</p><a href="#workspace">Take it for a row <Arrow/></a></footer>
  </div>;
}
