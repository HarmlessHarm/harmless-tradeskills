import { Fragment, useEffect, useState, type ComponentType } from 'react';
import { CharactersPage } from './ui/CharactersPage';
import { FavorPage } from './ui/FavorPage';
import { FlipPage } from './ui/FlipPage';
import { Icon } from './ui/icons';
import { ItemsPage } from './ui/ItemsPage';
import { RecipesPage } from './ui/RecipesPage';
import { SettingsPage } from './ui/SettingsPage';
import { TourProvider } from './ui/tour/Tour';
import { WelcomePage } from './ui/WelcomePage';
import { WorkflowsPage } from './ui/WorkflowsPage';
import { useStore } from './state/store';

/**
 * `divider` starts a new group: getting started stands alone, workflows and flips are personal
 * data, items and recipes game data, and settings covers both.
 */
const TABS = [
  { key: 'start', label: 'Get started', Page: WelcomePage },
  { key: 'workflows', label: 'Workflows', Page: WorkflowsPage, divider: true },
  { key: 'flip', label: 'AH flip', Page: FlipPage },
  { key: 'favor', label: 'Merchant Favor', Page: FavorPage },
  { key: 'characters', label: 'Characters', Page: CharactersPage },
  { key: 'items', label: 'Items', Page: ItemsPage, divider: true },
  { key: 'recipes', label: 'Recipes', Page: RecipesPage },
  { key: 'settings', label: 'Settings', Page: SettingsPage, divider: true },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * The hash is `#tab` or `#tab/sub`, where sub picks a section inside the tab. Without a known tab
 * the page opens on `fallback`.
 */
const fromHash = (fallback: TabKey): { tab: TabKey; sub?: string } => {
  const h = window.location.hash.slice(1);
  // Disenchant rules used to be a top-level tab.
  if (h === 'disenchant') return { tab: 'settings', sub: 'disenchant' };
  const [key, sub] = h.split('/');
  const tab = (TABS.find((t) => t.key === key)?.key ?? fallback) as TabKey;
  return { tab, sub };
};

export function App() {
  const { workflows, onboarding } = useStore();
  // Someone who has not started yet lands on getting started, everyone else on their workflows.
  const [fallback] = useState<TabKey>(!onboarding.completed && workflows.length === 0 && onboarding.tours.workflow === 'new' ? 'start' : 'workflows');
  const [{ tab, sub }, setRoute] = useState(() => fromHash(fallback));
  useEffect(() => {
    const onHash = () => setRoute(fromHash(fallback));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [fallback]);
  const Page: ComponentType<{ sub?: string }> = TABS.find((t) => t.key === tab)!.Page;
  // After the walkthrough, Get started leaves the menu (with its divider); the page stays reachable
  // from Settings > Tutorials.
  const shown = TABS.filter((t) => t.key !== 'start' || !onboarding.completed);

  return (
    <TourProvider>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="coin" aria-hidden />
            Harmless Tradeskills
          </div>
          <nav className="tabs">
            {shown.map((t, i) => (
              <Fragment key={t.key}>
                {'divider' in t && i > 0 && <span className="tab-divider" aria-hidden />}
                <a href={`#${t.key}`} className={t.key === tab ? 'on' : ''}>
                  {t.key === 'settings' && <Icon name="cog" />}
                  {t.label}
                </a>
              </Fragment>
            ))}
          </nav>
        </header>
        <main className="content">
          <Page sub={sub} />
        </main>
      </div>
    </TourProvider>
  );
}
