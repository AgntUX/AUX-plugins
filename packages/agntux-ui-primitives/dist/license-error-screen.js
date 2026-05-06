import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function LicenseErrorScreen({ message }) {
    return (_jsx("div", { className: "flex h-full items-center justify-center p-6", children: _jsxs("div", { className: "max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900", children: [_jsx("h2", { className: "mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100", children: "This view can't load right now" }), _jsx("p", { className: "whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300", children: message })] }) }));
}
