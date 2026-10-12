import { useEffect, useState } from 'react';
import { isAndroid } from '../platform';
import { isPhonePreview } from '../browserEnvironment';

export function useMobileLayout() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const mobile = isAndroid || isPhonePreview || narrow;
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document.body.dataset.mobile = String(mobile);
    return () => {
      delete document.body.dataset.mobile;
    };
  }, [mobile]);
  return mobile;
}
