import { useEffect } from "react";
import { setParams, useSearchParam } from "../lib/url-state";

interface Guide {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  sections: { title: string; text?: string; items?: string[] }[];
  example?: string;
  action?: { label: string; params: Record<string, string | null> };
}

const GUIDES: Guide[] = [
  {
    id: "getting-started", title: "Your first space", summary: "Set up a flat, a trip, or any shared budget.",
    steps: ["Choose + New space and give it a name.", "Choose Recurring for monthly costs, or One-time for a trip or event. Add the people sharing it; you are included as its owner.", "Optionally create groups and pick quick actions, then choose Create space."],
    sections: [
      { title: "Which kind should I choose?", items: ["Recurring: expenses and settlements can be viewed month by month. You can also choose All months.", "One-time: view and settle everything together."] },
      { title: "What happens next?", text: "Open Expenses to add your first cost. Members can add expenses and record payments. Owners also manage members, groups, quick actions, and space settings." },
    ],
    example: "Flat expenses → Recurring. Weekend in Goa → One-time.",
  },
  {
    id: "expenses", title: "Expenses & splits", summary: "Log one cost or several, and choose who shares each one.",
    steps: ["Open a space → Expenses → + Add expense. Enter the expense, amount, date, and who paid.", "Choose the people sharing the cost. Search names, use Everyone, or select groups. Enter toggles a search result; checkboxes support multiple selections.", "Choose a split method, check the per-person preview, and select Add expense. Save & add another keeps the date, payer, and people for the next cost."],
    sections: [
      { title: "Four ways to split", items: ["Equal: divide the total evenly among selected people.", "Amounts: enter each person’s exact amount; these must add up to the total.", "Percent: enter percentages that add up to 100%.", "Shares: enter relative weights. Two shares means twice as much as one."] },
      { title: "Adding several expenses", text: "Choose Add several. Each row has its own payer, people, and split method; the date applies to the batch. Select a row’s split to edit it in the side panel. Copy split to next expense reuses that split. Drafts stay in this browser until saved; if a row fails validation, none of the batch is saved." },
      { title: "Find or correct an expense", text: "Use the month picker, search, Paid by, and Involving filters. Involving finds expenses shared by the selected person. Use Edit on a saved expense to correct it." },
    ],
    example: "₹900 dinner shared equally by three people → ₹300 each. The person who paid still has their own ₹300 share.",
  },
  {
    id: "groups", title: "Groups & quick actions", summary: "Save your usual combinations of people for faster splits.",
    steps: ["As a space owner, open its Groups tab → Create group. Give it a name and choose members of this space.", "While adding an expense, select a Quick group above the people list, or switch Individuals to Groups to find more.", "Open the space’s Quick actions tab to choose and order up to three group shortcuts, or use the latest groups automatically."],
    sections: [
      { title: "What a group does", text: "A group is a saved selection of people inside one space. Everyone in the space can use it; owners create and edit it. Add someone to Members before including them in a group." },
      { title: "Selecting more than one group", text: "The first selected group replaces the current people selection. Further groups combine their members; someone in two groups is counted once. Review individuals to check each person’s share. In Add several, groups apply to the selected transaction only." },
      { title: "Automatic shortcuts", text: "Without custom configuration, the newest three groups by creation date appear automatically. Editing a group later does not change the people or amounts on expenses already saved." },
    ],
    example: "A space called Flat expenses might have Food, Rent, and Weekend groups, each with a different set of flatmates.",
  },
  {
    id: "balances", title: "Balances & settling up", summary: "Understand what you owe and record money paid back.",
    steps: ["Open Balances & settle up in the space. For a recurring space, choose the month you want to settle.", "Check the suggested payments and send the money using your usual payment method.", "Once the money has moved, choose Record beside the suggestion, or + Record a payment. Check sender, recipient, amount, and settlement month."],
    sections: [
      { title: "Reading your balance", items: ["Positive / You are owed: you should receive money overall.", "Negative / You owe: you should pay money overall.", "Zero / Settled: your balance is clear for the selected period."] },
      { title: "Expense or payment?", text: "An expense logs a shared purchase. A recorded payment logs money sent to settle a debt; it is not another purchase. Expense Tracker records the payment, but does not transfer money." },
      { title: "Month and payment date", text: "For recurring spaces, the settlement month decides which month a payment clears. A payment made in November can settle October. Simplify debts suggests fewer transfers while keeping everyone’s net balance the same." },
    ],
    example: "You paid ₹900 for a three-person dinner. Your own share is ₹300, so you are owed ₹600. Recording repayments reduces that balance.",
  },
  {
    id: "people", title: "People & space members", summary: "Find registered people and manage who shares a space.",
    steps: ["Open People in the sidebar. Search by name and browse the pages; email addresses are kept private in this directory.", "Select people across pages, then choose New space with… to start together. You are included automatically.", "For an existing space, its owner can open Members to add people or manage membership."],
    sections: [
      { title: "Directory vs. members", text: "People lists registered users on the platform. A space’s Members list contains only the people sharing that space. Finding someone in the directory does not give you access to their spaces." },
      { title: "Someone is missing", text: "Ask them to sign in to the platform, then refresh People. Search by their display name. The email invitation option, where shown, does not send an invitation email." },
      { title: "Leaving a space", text: "A member must have a zero all-time balance before leaving or being removed. The last owner cannot leave. Former members remain on historical expenses so the records still make sense." },
    ],
    action: { label: "Open People", params: { v: "people", doc: null } },
  },
  {
    id: "integrations", title: "iPhone, ChatGPT & Claude", summary: "Add and check expenses from your phone or an AI assistant.",
    steps: ["Open Settings → iPhone & AI apps. Create a personal key named for the app using it, such as iPhone, ChatGPT, or Claude.", "Copy the key when it appears; it is shown only once. For an AI app, also copy the connector address. Follow the setup guide on that Settings page.", "For the iPhone shortcut, choose the space and people, then enter an amount. With an AI assistant, name the space, cost, payer, and people as clearly as possible."],
    sections: [
      { title: "What can an AI assistant do?", text: "With the connector configured, it can list spaces and registered people, create a space, check expenses, payments, and balances, add or edit expenses, and record payments. Ask it to clarify ambiguous people or space names before saving." },
      { title: "Keys and access", text: "Use a separate key per app so you can revoke one independently. Currently all personal keys have the same permissions; their names do not restrict them to Shortcut or MCP use. Keys cannot delete records, merge people, or manage keys. Space permissions still apply." },
      { title: "After saving outside the app", text: "Choose Refresh in the space to see changes from your shortcut or assistant. If a key expires or is revoked, create or regenerate a key and update the integration. Keep both the key and connector address private." },
    ],
    example: "“In Flat expenses, add ₹900 for dinner today, paid by me, split equally between me, Asha, and Bala.” Check the assistant’s saved result.",
    action: { label: "Open integration setup", params: { v: "account", f: "shortcut", doc: null } },
  },
  {
    id: "settings", title: "Settings & everyday tips", summary: "Change your profile, pick a theme, and find the right month.",
    steps: ["Open your account menu at the bottom of the sidebar. On a phone, open Menu first.", "Choose Profile to change your display name, Appearance for Light / Dark / Auto, or iPhone & AI apps for integration keys.", "Inside a space, use its own Settings tab for shared space options. Space owners manage these settings."],
    sections: [
      { title: "Finding another month", text: "In a recurring space, use the arrows beside the month or click the month to pick a month and year. You can open empty months too. This month returns to the current month; All months shows everything." },
      { title: "Keeping the view up to date", text: "The app keeps recently loaded data to make navigation faster. Use Refresh to check for changes made by another person or an integration." },
      { title: "This browser", text: "Your theme preference and unsaved bulk drafts are stored in this browser. Auto follows your device’s theme. Signing out clears the cached account data; save any expenses you want to keep before switching devices." },
    ],
    action: { label: "Open Settings", params: { v: "account", f: null, doc: null } },
  },
  {
    id: "terms", title: "Common terms", summary: "A quick reference for the words used in the app.", steps: [],
    sections: [
      { title: "Space", text: "The shared place where expenses, people, groups, and balances live. Recurring spaces are monthly; one-time spaces cover a whole trip or event." },
      { title: "Owner and member", text: "A member can view the space and add expenses and payments. An owner also manages people, groups, shortcuts, and settings. The creator starts as an owner." },
      { title: "Payer and participants", text: "The payer paid for the purchase. Participants are the people sharing its cost. The payer does not have to be one of the participants." },
      { title: "Split and your share", text: "The split defines how a cost is divided. Your share is your part of that expense, regardless of who paid." },
      { title: "Balance and settlement", text: "Your balance is what you should receive or pay after shared costs and repayments. A settlement is a recorded repayment against that balance." },
      { title: "Group and quick action", text: "A group is a saved set of members within one space. A quick action puts a group shortcut in the expense form; up to three are shown." },
      { title: "Personal key and MCP", text: "A personal key lets an integration act as you. MCP is the connection your AI assistant uses to call Expense Tracker’s tools." },
    ],
  },
];

const TOPICS = ["Start here", "Expenses", "Groups", "Balances", "People", "iPhone & AI", "Settings", "Terms"];

/** All help lives on one page; topic links only scroll to a section. */
export function DocsPage() {
  const [legacyGuide] = useSearchParam("doc");
  useEffect(() => {
    // Keep old guide URLs useful, and restore anchors after the signed-in app loads.
    const guide = GUIDES.find((item) => item.id === legacyGuide);
    const anchor = window.location.hash.startsWith("#docs-") ? window.location.hash.slice(1) : guide ? `docs-${guide.id}` : "";
    const frame = requestAnimationFrame(() => {
      const target = anchor.startsWith("docs-") ? document.getElementById(anchor) : null;
      if (target) target.scrollIntoView();
      else window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [legacyGuide]);

  return <section className="docs-page" aria-labelledby="docs-title" id="docs-top">
    <header className="docs-hero">
      <div className="docs-hero-copy">
        <span className="docs-eyebrow">Expense Tracker / Docs</span>
        <h1 id="docs-title">Shared expenses,<br /><span>made simple.</span></h1>
        <p>From your first space to the final repayment. Everything you need in one place, with short steps and everyday examples.</p>
        <div className="docs-hero-actions"><a className="btn primary" href="#docs-getting-started">Start here <span aria-hidden="true">↓</span></a><a className="docs-text-link" href="#docs-terms">Learn the terms →</a></div>
        <span className="docs-hero-note">Read straight through, or jump to what you need.</span>
      </div>
      <figure className="docs-preview" aria-label="Example of an equal dinner split">
        <div className="docs-preview-heading"><span>Dinner with friends</span><span className="docs-preview-tag">Equal split</span></div>
        <strong className="docs-preview-total">₹900<span>paid by you · shared by 3</span></strong>
        <div className="docs-preview-people">{["You", "Asha", "Bala"].map((name) => <div key={name}><span className="docs-preview-avatar" aria-hidden="true">{name.slice(0, 1)}</span><span>{name}</span><strong>₹300</strong></div>)}</div>
        <figcaption><span>Your share <strong>₹300</strong></span><span>You are owed <strong>₹600</strong></span></figcaption>
      </figure>
    </header>

    <ol className="docs-journey" aria-label="The shared expense workflow">
      <li><span>01</span><div><strong>Create a space</strong><p>Bring your people together.</p></div></li>
      <li><span>02</span><div><strong>Log the shared costs</strong><p>Choose who paid and who shares.</p></div></li>
      <li><span>03</span><div><strong>Settle up</strong><p>Pay back, then record the payment.</p></div></li>
    </ol>

    <nav className="docs-jump" aria-label="On this page"><span>Jump to</span><div>{GUIDES.map((guide, index) => <a key={guide.id} href={`#docs-${guide.id}`}>{TOPICS[index]}</a>)}</div></nav>

    <div className="docs-chapters">{GUIDES.map((guide, index) => <section key={guide.id} id={`docs-${guide.id}`} tabIndex={-1} className={`docs-chapter${guide.steps.length ? "" : " docs-glossary"}`} aria-labelledby={`docs-${guide.id}-title`}>
      <header className="docs-chapter-heading"><span className="docs-chapter-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div><h2 id={`docs-${guide.id}-title`}>{guide.title}</h2><p>{guide.summary}</p></div></header>
      <div className="docs-chapter-body">
        {!!guide.steps.length && <div className="docs-walkthrough"><h3>How to do it</h3><ol className="docs-steps">{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>{guide.example && <aside className="docs-example"><strong>For example</strong><p>{guide.example}</p></aside>}</div>}
        <div className="docs-notes">{guide.sections.map((section) => <section key={section.title} className="docs-section"><h3>{section.title}</h3>{section.text && <p>{section.text}</p>}{section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}</section>)}</div>
      </div>
      {guide.action && <div className="docs-chapter-action"><button type="button" className="btn" onClick={() => setParams(guide.action!.params)}>{guide.action.label} →</button></div>}
    </section>)}</div>

    <footer className="docs-footer"><div><strong>You’re ready to split.</strong><p>Start small. Your next shared cost is a good place to begin.</p></div><a href="#docs-top" className="docs-text-link">Back to top ↑</a><p className="docs-credit">Made with <span role="img" aria-label="love">❤️</span> by Ishan &amp; Piyush</p></footer>
  </section>;
}
