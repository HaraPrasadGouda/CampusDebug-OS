// Shared password input with show/hide (eye) toggle, used by the login
// screen, forced first-login change and Settings → Change Password.
import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

// iconClassName / toggleClassName / toggleIconClassName are optional, purely
// visual overrides (used by the login screen); omitted = the original look.
export default function PasswordInput({ value, onChange, placeholder, autoComplete, className, leadingIcon: LeadingIcon, iconClassName, toggleClassName, toggleIconClassName }) {
    const [visible, setVisible] = React.useState(false);

    return (
        <div className="relative">
            {LeadingIcon && (
                <LeadingIcon className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none ${iconClassName || ''}`} aria-hidden="true" />
            )}
            <input
                type={visible ? 'text' : 'password'}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                autoComplete={autoComplete}
                className={`${className || ''} pr-10 ${LeadingIcon ? 'pl-10' : ''}`}
            />
            <button
                type="button"
                onClick={() => setVisible(v => !v)}
                title={visible ? 'Hide password' : 'Show password (check what you typed)'}
                className={toggleClassName || "absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer p-0.5"}
            >
                {visible ? <EyeOff className={toggleIconClassName || "w-4 h-4"} /> : <Eye className={toggleIconClassName || "w-4 h-4"} />}
            </button>
        </div>
    );
}
