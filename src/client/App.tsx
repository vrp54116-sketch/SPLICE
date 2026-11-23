import { AnimatePresence, motion } from 'motion/react';
import { Shell } from './components/Shell';
import { useApp } from './store/useApp';
import { Home } from './pages/Home';
import { Configure } from './pages/Configure';
import { Processing } from './pages/Processing';
import { Results } from './pages/Results';
import { Editor } from './pages/Editor';
import { Library } from './pages/Library';
import { Brand } from './pages/Brand';
import { Scheduler } from './pages/Scheduler';
import { Stats } from './pages/Stats';
import { Settings } from './pages/Settings';

const PAGES = {
  home: Home, configure: Configure, processing: Processing, results: Results,
  editor: Editor, library: Library, brand: Brand, scheduler: Scheduler,
  stats: Stats, settings: Settings,
} as const;

export default function App() {
  const page = useApp((s) => s.page);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const Page = PAGES[page];
  return <Shell onBoot={() => { /* health is polled by the pages themselves */ }}>
    <AnimatePresence mode="wait">
      <motion.div key={page} initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -8 }}
        transition={{ duration: reduced ? .12 : .28, ease: [0.2, 0.8, 0.2, 1] }}>
        <Page />
      </motion.div>
    </AnimatePresence>
  </Shell>;
}
