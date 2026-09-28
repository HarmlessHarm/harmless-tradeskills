import { useEffect, useState } from 'react';
import { DisenchantPage } from './ui/DisenchantPage';
import { FlipPage } from './ui/FlipPage';
import { ItemsPage } from './ui/ItemsPage';
import { RecipesPage } from './ui/RecipesPage';
import { SettingsPage } from './ui/SettingsPage';
import { WorkflowsPage } from './ui/WorkflowsPage';

const TABS = [
  { key: 'workflows', label: 'Workflows', Page: WorkflowsPage },
  { key: 'flip', label: 'AH flip', Page: FlipPage },
  { key: 'items', label: 'Items', Page: ItemsPage },
  { key: 'recipes', label: 'Recipes', Page: RecipesPage },
  { key: 'disenchant', label: 'Disenchant', Page: DisenchantPage },
  { key: 'settings', label: 'Settings', Page: SettingsPage },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const fromHash = (): TabKey => {
  const h = window.location.hash.slice(1);
  return (TABS.find((t) => t.key === h)?.key ?? 'workflows') as TabKey;
};

export function App() {
  const [tab, setTab] = useState<TabKey>(fromHash);
  useEffect(() => {
    const onHash = () => setTab(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const { Page } = TABS.find((t) => t.key === tab)!;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="coin" aria-hidden />
          Harmless Tradeskills
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <a key={t.key} href={`#${t.key}`} className={t.key === tab ? 'on' : ''}>
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="content">
        <Page />
      </main>
    </div>
  );
}
