import React from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[CampusDebug OS ErrorBoundary Caught Exception]:', error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      // Ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4 font-sans text-center">
          <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 sm:p-8 space-y-5 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <div>
              <h1 className="text-xl font-bold text-white">CampusDebug OS Fault Recovery</h1>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                Unhandled Exception Caught in Component Lifecycle
              </p>
            </div>

            <div className="bg-slate-900 p-3 rounded-xl border border-slate-700 text-left text-[11px] font-mono text-rose-300 max-h-32 overflow-y-auto">
              {this.state.error?.toString() || 'Unknown React Runtime Error'}
            </div>

            <button
              onClick={this.handleReset}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-md"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reset App & Reload State</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
