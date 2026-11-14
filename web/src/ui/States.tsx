import { useEffect, useState } from 'react';
import { Logo } from './icons';

/** Before the tour arrives. Blank for the first moment, so a fast load never flashes anything. */
export function Loading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 350);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex h-full flex-col bg-bg" aria-busy="true">
      <div className="h-12 flex-none border-b border-line" />
      {show && (
        <div className="fade mx-auto w-full max-w-[900px] px-4 pt-10 sm:px-6 sm:pt-14" role="status" aria-label="Loading the pull request">
          <div className="skeleton h-6 w-44 rounded-md" />
          <div className="skeleton mt-5 h-8 w-[min(560px,90%)] rounded-md" />
          <div className="skeleton mt-3 h-4 w-[min(420px,70%)] rounded" />
          <div className="mt-8 overflow-hidden rounded-[10px] border border-line">
            <div className="h-9 border-b border-line bg-panel" />
            <div className="space-y-2.5 px-4 py-4">
              {[72, 54, 88, 40, 66, 80, 48].map((w, i) => (
                <div key={i} className="skeleton h-3 rounded" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The tour could not be loaded: say what happened and offer the one thing that helps. */
export function LoadFailed({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <div className="rise w-full max-w-[400px]">
        <Logo size={24} />
        <h1 className="mt-5 text-[19px] leading-[1.3] font-[590] tracking-[-0.012em] text-fg">This review could not be loaded</h1>
        <p className="mt-2 text-[14px] leading-[1.55] text-fg3">{!message || /fetch|network|load failed/i.test(message) ? 'The server did not answer. Check your connection, then load it again.' : message}</p>
        <button className="btn btn-primary mt-6" onClick={() => location.reload()}>
          Load again
        </button>
      </div>
    </div>
  );
}
