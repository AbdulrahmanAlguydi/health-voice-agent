import { expect, it } from 'vitest';
import { resolveRelativeReceptionWindow } from '../../src/server/reception/windows';
it.each(['next Thursday','الخميس الجاي','الخميس القادم','in 5 days','بعد ٥ أيام'])('resolves supported local day expression %s',expression=>{
  expect(resolveRelativeReceptionWindow(expression,'2026-10-03',30)).toEqual({fromDate:'2026-10-08',toDate:'2026-10-09'});
});
it('resolves the following Thursday when today is Thursday and rolls across year end',()=>{
  expect(resolveRelativeReceptionWindow('next Thursday','2026-10-08',30)).toEqual({fromDate:'2026-10-15',toDate:'2026-10-16'});
  expect(resolveRelativeReceptionWindow('in 3 days','2026-12-30',30)).toEqual({fromDate:'2027-01-02',toDate:'2027-01-03'});
  expect(resolveRelativeReceptionWindow('some Thursday','2026-10-03',30)).toBeUndefined();
});
