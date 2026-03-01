"use client";

export default function Modal({ title, onClose, children }) {
  return (
    <div className="enterprise-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="enterprise-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="enterprise-modal-header">
          <h3>{title}</h3>
          <button className="enterprise-button-secondary" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
