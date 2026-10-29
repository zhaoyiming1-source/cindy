import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mountPage } from '../../ui-page/harness';
import { EffortSlider } from '../../../src/renderer/components/ui/effort-slider';
import type { Effort } from '../../../src/renderer/lib/userPreferences.types';
function Fixture() {
  const { t } = useTranslation();
  const [value, setValue] = useState<Effort>('low');
  const save = useRef<() => void>(() => {});
  return <main className="min-h-screen bg-[var(--surface)] p-8 text-[var(--text-primary)]">
    <section className="w-[280px] rounded-xl border border-[var(--border-default)] bg-[var(--card)] p-4">
      <p>{t('update.banner.personalFailureTitle')}</p>
      <p className="text-13">{t('update.banner.personalFailureDescription')}</p>
      <EffortSlider stops={['low', 'medium', 'high']} value={value} labelOf={(effort) => t(`effortLevels.${effort}`)}
        scopeKey="existing-task" onChange={(effort) => new Promise<boolean>((resolve) => {
          save.current = () => { setValue(effort); resolve(true); };
        })} />
      <button onClick={() => save.current()}>Complete save</button>
    </section>
  </main>;
}
void mountPage({ host: {}, render: () => <Fixture /> });
