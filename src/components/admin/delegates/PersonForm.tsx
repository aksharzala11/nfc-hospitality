"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { AlertCircle, Loader2, Mail, MessageSquareText } from "lucide-react";
import type { OtpChannel, UserRole } from "@prisma/client";
import type {
  DirectoryPerson,
  PersonField,
  PersonFieldErrors,
  PersonFormValues,
  PersonPayload,
  SavePersonResult,
} from "@/lib/admin/delegates";
import { createPerson, updatePerson } from "@/app/admin/delegates/actions";
import { ROLE_LABEL, ROLE_ORDER, bapsEmail, formatPhone } from "./directory";
import { SheetBody, SheetFooter } from "./Sheet";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, INPUT_INVALID, INPUT_READONLY, LABEL } from "./ui";

export type PersonFormMode = { kind: "create"; bapsId?: string } | { kind: "edit"; person: DirectoryPerson };

// Same limits as LIMITS in src/lib/admin/delegates.ts (the server re-checks everything).
const MAX = {
  bapsId: 32,
  registrationId: 32,
  name: 100,
  displayName: 60,
  seva: 60,
  region: 60,
  center: 80,
  email: 254,
  phone: 24,
} as const;

const ROLE_HELP: Record<UserRole, string> = {
  DELEGATE: "Uses the delegate hub: schedule, menus and breakouts.",
  SANT: "Pujya Sant: gets the Santo view with their own programme, menu, breakouts, utaro and transport.",
  ADMIN: "Organiser: can also change the live schedule and message everyone.",
};

/** Where to put focus for each field's error, top to bottom. */
const FIELD_ORDER: PersonField[] = [
  "bapsId",
  "registrationId",
  "name",
  "displayName",
  "seva",
  "center",
  "region",
  "email",
  "phone",
  "contact",
  "preferredChannel",
  "gender",
  "role",
];

function blankValues(bapsId = ""): PersonFormValues {
  return {
    bapsId,
    registrationId: "",
    name: "",
    displayName: "",
    seva: "",
    email: "",
    phone: "",
    preferredChannel: "EMAIL",
    gender: "",
    region: "",
    center: "",
    role: "DELEGATE",
  };
}

function valuesOf(p: DirectoryPerson): PersonFormValues {
  return {
    bapsId: p.bapsId,
    registrationId: p.registrationId ?? "",
    name: p.name,
    displayName: p.displayName ?? "",
    seva: p.seva,
    email: p.email ?? "",
    phone: p.phone ? formatPhone(p.phone) : "",
    preferredChannel: p.preferredChannel,
    gender: p.gender ?? "",
    region: p.region ?? "",
    center: p.center ?? "",
    role: p.role,
  };
}

/** Until the admin picks a channel: email if there is one, otherwise SMS if there's a phone. */
function suggestedChannel(v: PersonFormValues): OtpChannel {
  if (v.email.trim()) return "EMAIL";
  return v.phone.trim() ? "SMS" : "EMAIL";
}

type Props = {
  mode: PersonFormMode;
  /** The signed-in admin (they can't remove their own ADMIN role). */
  viewerId: string;
  sevaOptions: readonly string[];
  regionOptions: readonly string[];
  centerOptions: readonly string[];
  /** Someone already in the directory with this BAPS ID, for the live "already added" hint. */
  findByBapsId: (bapsId: string) => DirectoryPerson | undefined;
  /** Whoever already has this registration ID, for the live "already used" hint. */
  findByRegistrationId: (registrationId: string) => DirectoryPerson | undefined;
  onOpenPerson: (id: string) => void;
  onSaved: (person: DirectoryPerson) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};

/** Add and edit form for one person, laid out for the directory's sheet. */
export function PersonForm({
  mode,
  viewerId,
  sevaOptions,
  regionOptions,
  centerOptions,
  findByBapsId,
  findByRegistrationId,
  onOpenPerson,
  onSaved,
  onCancel,
  onDirtyChange,
  onBusyChange,
}: Props) {
  const uid = useId();
  const fieldId = (field: string) => `${uid}-${field}`;
  const person = mode.kind === "edit" ? mode.person : null;

  const [initial] = useState<PersonFormValues>(() =>
    mode.kind === "edit" ? valuesOf(mode.person) : blankValues(mode.bapsId),
  );
  const [values, setValues] = useState(initial);
  const [channelChosen, setChannelChosen] = useState(mode.kind === "edit");
  const [errors, setErrors] = useState<PersonFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);

  const channel = channelChosen ? values.preferredChannel : suggestedChannel(values);
  const isSelf = person !== null && person.id === viewerId;
  const tester = person?.hasTestCode ?? false;
  // A master-list delegate: re-running the import (reconcile() in src/lib/delegateImport.ts)
  // writes the list's values back over most of these fields.
  const imported = person !== null && person.registrationId !== null && person.role === "DELEGATE";
  const clash =
    mode.kind === "create" && values.bapsId.length >= 3 ? findByBapsId(values.bapsId) : undefined;
  // Start in the BAPS ID field for a blank add form, otherwise in the name.
  const focusName = mode.kind === "edit" || initial.bapsId !== "";

  // Registration ID: someone else who has it (the server re-checks), and what an edit does to the link.
  const registrationId = values.registrationId.trim();
  const holder = registrationId ? findByRegistrationId(registrationId) : undefined;
  const registrationClash = holder && holder.id !== person?.id ? holder : undefined;
  const relinking = initial.registrationId !== "" && registrationId !== initial.registrationId;
  const registrationHint =
    mode.kind === "create"
      ? "Optional: the master list's User Id, e.g. 12345."
      : !relinking
        ? "The master list's User Id. Imports find people by it."
        : registrationId === ""
          ? "Imports find people by this ID: clearing it unlinks them from their master-list row."
          : "Imports find people by this ID: they'll follow that master-list row instead.";

  // A delegate's default email is <BAPS ID>@na.baps.id (as the import gives it): offer it while
  // the field is empty (not for santos, admins or testers, whose IDs aren't real BAPS mailboxes).
  const emailSuggestion =
    values.email.trim() === "" && values.role === "DELEGATE" && !tester ? bapsEmail(values.bapsId) : null;

  const dirty = (Object.keys(initial) as (keyof PersonFormValues)[]).some((key) =>
    key === "preferredChannel"
      ? channelChosen && values.preferredChannel !== initial.preferredChannel
      : values[key] !== initial[key],
  );

  // Report dirty/busy to the directory (it guards closing the sheet), through a
  // ref so the parent's callback identity doesn't matter.
  const report = useRef({ onDirtyChange, onBusyChange });
  useEffect(() => {
    report.current = { onDirtyChange, onBusyChange };
  });
  useEffect(() => {
    report.current.onDirtyChange(dirty);
  }, [dirty]);
  useEffect(() => {
    report.current.onBusyChange(pending);
  }, [pending]);
  useEffect(
    () => () => {
      report.current.onDirtyChange(false);
      report.current.onBusyChange(false);
    },
    [],
  );
  useEffect(() => {
    firstFieldRef.current?.focus({ preventScroll: true });
  }, []);
  // The banner sits at the top of the form; the Save button that caused it is at the bottom.
  useEffect(() => {
    if (formError) formErrorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [formError]);

  function set<K extends keyof PersonFormValues>(key: K, value: PersonFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    // Contact, channel and role errors depend on each other, so any of them clears the group.
    const related: PersonField[] =
      key === "email" || key === "phone" || key === "preferredChannel" || key === "role"
        ? [key, "email", "phone", "contact", "preferredChannel"]
        : [key];
    setErrors((current) => {
      if (!related.some((f) => current[f])) return current;
      const next = { ...current };
      for (const f of related) delete next[f];
      return next;
    });
  }

  function focusField(field: PersonField) {
    const target = field === "contact" ? "email" : field;
    const el =
      document.getElementById(fieldId(target)) ??
      document.querySelector<HTMLElement>(`[data-field="${target}"] input:not([disabled])`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError(null);
    const payload: PersonPayload =
      mode.kind === "edit"
        ? {
            ...values,
            preferredChannel: channel,
            // Sent only when changed: the import may have linked them since this form opened.
            registrationId: values.registrationId !== initial.registrationId ? values.registrationId : undefined,
            center: values.center !== initial.center ? values.center : undefined,
          }
        : { ...values, preferredChannel: channel };
    startTransition(async () => {
      let result: SavePersonResult;
      try {
        result =
          mode.kind === "create" ? await createPerson(payload) : await updatePerson(mode.person.id, payload);
      } catch {
        setFormError("Couldn't reach the server. Check your connection and try again.");
        return;
      }
      if (result.ok) {
        onSaved(result.person);
        return;
      }
      const fieldErrors = result.fieldErrors ?? {};
      setErrors(fieldErrors);
      setFormError(result.error ?? null);
      const first = FIELD_ORDER.find((f) => fieldErrors[f]);
      if (first) focusField(first);
    });
  }

  /** id, invalid state and description wiring for one text input. `extra`: another message id to read out. */
  function a11y(field: PersonField, hint?: boolean, extra?: string) {
    const id = fieldId(field);
    const error = errors[field];
    // The email-or-phone message sits under both contact fields.
    const contactError = (field === "email" || field === "phone") && errors.contact;
    const describedBy = [
      error ? `${id}-error` : hint ? `${id}-hint` : null,
      contactError ? fieldId("contact-error") : null,
      extra ?? null,
    ].filter(Boolean);
    return {
      id,
      "aria-invalid": error || contactError ? true : undefined,
      "aria-describedby": describedBy.length ? describedBy.join(" ") : undefined,
      className: error || contactError ? INPUT_INVALID : INPUT,
    };
  }

  const contactHint = tester
    ? values.role === "ADMIN"
      ? "Admins can't sign in with tester codes, so this account needs an email or phone."
      : "Tester account: it signs in with its fixed code, so email and phone are optional."
    : null;

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetBody>
        {formError && (
          <p
            ref={formErrorRef}
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-2xl border border-ember-500/25 bg-ember-500/8 px-3.5 py-3 text-sm font-medium text-ember-700"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {formError}
          </p>
        )}

        {imported && (
          <p className="mb-4 rounded-xl bg-coral-50 px-3.5 py-2.5 text-xs leading-relaxed text-ink-800 ring-1 ring-inset ring-coral-200">
            From the organisers&apos; master list: the next import puts back the list&apos;s name, email, seva,
            region, center, gender, sign-in channel and phone (when the list has one). Ask the organisers to
            correct the list too.
          </p>
        )}

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {mode.kind === "create" ? (
              <Field id={fieldId("bapsId")} label="BAPS ID" required error={errors.bapsId} hint={clash ? undefined : "3–32 letters and digits. They sign in with it."}>
                <input
                  ref={focusName ? undefined : firstFieldRef}
                  {...a11y("bapsId", !clash, clash ? fieldId("bapsId-clash") : undefined)}
                  name="bapsId"
                  value={values.bapsId}
                  onChange={(e) => set("bapsId", e.target.value.toUpperCase().replace(/\s/g, ""))}
                  maxLength={MAX.bapsId}
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="e.g. BK1001"
                  aria-required="true"
                />
                {clash && (
                  <p
                    id={fieldId("bapsId-clash")}
                    className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs font-medium text-ember-700"
                  >
                    <span>Already in the directory: {clash.name}.</span>
                    <button
                      type="button"
                      onClick={() => onOpenPerson(clash.id)}
                      className="font-semibold text-ink-900 underline decoration-ink-800/30 underline-offset-2 hover:decoration-ink-900"
                    >
                      Open their details
                    </button>
                  </p>
                )}
              </Field>
            ) : (
              <Field id={fieldId("bapsId")} label="BAPS ID" hint="BAPS IDs can't be changed: they're how people sign in.">
                <input
                  id={fieldId("bapsId")}
                  aria-describedby={`${fieldId("bapsId")}-hint`}
                  value={values.bapsId}
                  readOnly
                  className={INPUT_READONLY}
                />
              </Field>
            )}
            <Field
              id={fieldId("registrationId")}
              label="Registration ID"
              error={errors.registrationId}
              hint={registrationClash ? undefined : registrationHint}
              hintTone={relinking ? "warn" : undefined}
            >
              <input
                {...a11y(
                  "registrationId",
                  !registrationClash,
                  registrationClash ? fieldId("registrationId-clash") : undefined,
                )}
                name="registrationId"
                value={values.registrationId}
                onChange={(e) => set("registrationId", e.target.value.replace(/\s/g, ""))}
                maxLength={MAX.registrationId}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. 12345"
              />
              {registrationClash && (
                <p
                  id={fieldId("registrationId-clash")}
                  className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs font-medium text-ember-700"
                >
                  <span>Already used by {registrationClash.name} ({registrationClash.bapsId}).</span>
                  {mode.kind === "create" && (
                    <button
                      type="button"
                      onClick={() => onOpenPerson(registrationClash.id)}
                      className="font-semibold text-ink-900 underline decoration-ink-800/30 underline-offset-2 hover:decoration-ink-900"
                    >
                      Open their details
                    </button>
                  )}
                </p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field id={fieldId("name")} label="Full name" required error={errors.name}>
              <input
                ref={focusName ? firstFieldRef : undefined}
                {...a11y("name")}
                name="name"
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                maxLength={MAX.name}
                autoComplete="off"
                autoCapitalize="words"
                aria-required="true"
                placeholder="e.g. Upsham Naik"
              />
            </Field>
            <Field
              id={fieldId("displayName")}
              label="Display name"
              error={errors.displayName}
              hint="Greeting name. Blank uses the full name."
            >
              <input
                {...a11y("displayName", true)}
                name="displayName"
                value={values.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                maxLength={MAX.displayName}
                autoComplete="off"
                autoCapitalize="words"
                placeholder="e.g. Upshambhai"
              />
            </Field>
          </div>

          <Field id={fieldId("seva")} label="Seva" required error={errors.seva} hint="Pick a suggestion to keep groups tidy.">
            <input
              {...a11y("seva", true)}
              name="seva"
              list={fieldId("seva-list")}
              value={values.seva}
              onChange={(e) => set("seva", e.target.value)}
              maxLength={MAX.seva}
              autoComplete="off"
              autoCapitalize="words"
              aria-required="true"
              placeholder="e.g. Hospitality"
            />
            <datalist id={fieldId("seva-list")}>
              {sevaOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field id={fieldId("center")} label="Center" error={errors.center}>
              <input
                {...a11y("center")}
                name="center"
                list={fieldId("center-list")}
                value={values.center}
                onChange={(e) => set("center", e.target.value)}
                maxLength={MAX.center}
                autoComplete="off"
                autoCapitalize="words"
                placeholder="e.g. Edison"
              />
              <datalist id={fieldId("center-list")}>
                {centerOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field id={fieldId("region")} label="Region" error={errors.region}>
              <input
                {...a11y("region")}
                name="region"
                list={fieldId("region-list")}
                value={values.region}
                onChange={(e) => set("region", e.target.value)}
                maxLength={MAX.region}
                autoComplete="off"
                autoCapitalize="words"
                placeholder="e.g. Atlanta"
              />
              <datalist id={fieldId("region-list")}>
                {regionOptions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
          </div>
        </div>

        <Section title="Sign-in">
          {contactHint && (
            <p className="rounded-xl bg-coral-50 px-3.5 py-2.5 text-xs leading-relaxed text-ink-800 ring-1 ring-inset ring-coral-200">
              {contactHint}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Field id={fieldId("email")} label="Email" error={errors.email}>
              <input
                {...a11y("email")}
                name="email"
                type="email"
                inputMode="email"
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
                maxLength={MAX.email}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="name@example.com"
              />
              {emailSuggestion && (
                <button
                  type="button"
                  onClick={() => set("email", emailSuggestion)}
                  className="relative mt-1.5 max-w-full rounded-sm text-left text-xs font-semibold text-ink-900 underline decoration-ink-800/30 underline-offset-2 [overflow-wrap:anywhere] before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] hover:decoration-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-600"
                >
                  Use {emailSuggestion}
                </button>
              )}
            </Field>
            <Field id={fieldId("phone")} label="Phone" error={errors.phone} hint="US/Canada: 10 digits. Elsewhere: start with +.">
              <input
                {...a11y("phone", true)}
                name="phone"
                type="tel"
                inputMode="tel"
                value={values.phone}
                onChange={(e) => set("phone", e.target.value)}
                maxLength={MAX.phone}
                autoComplete="off"
                placeholder="(732) 555-0123"
              />
            </Field>
          </div>
          {errors.contact && <ErrorText id={fieldId("contact-error")}>{errors.contact}</ErrorText>}

          <Choice
            field="preferredChannel"
            name={fieldId("channel")}
            legend="Send sign-in codes by"
            value={channel}
            onChange={(v) => {
              setChannelChosen(true);
              set("preferredChannel", v);
            }}
            options={[
              { value: "EMAIL", label: "Email", icon: <Mail className="h-4 w-4" /> },
              { value: "SMS", label: "SMS", icon: <MessageSquareText className="h-4 w-4" /> },
            ]}
            hint={imported ? "The next master-list import sets this back to email." : undefined}
            error={errors.preferredChannel}
          />
        </Section>

        <Section title="Schedule track">
          <Choice
            field="gender"
            name={fieldId("gender")}
            legend="Gender"
            value={values.gender}
            onChange={(v) => set("gender", v)}
            options={[
              { value: "MALE", label: "Male" },
              { value: "FEMALE", label: "Female" },
              { value: "", label: "Not set" },
            ]}
            hint="Picks their schedule: Male sees the Bhaio (gents) track, Female the Behno (ladies) track. Not set shows both."
            error={errors.gender}
          />
        </Section>

        <Section title="Access">
          <fieldset data-field="role" aria-describedby={errors.role ? `${fieldId("role")}-error` : undefined}>
            <legend className={LABEL}>Role</legend>
            <div className="mt-1.5 space-y-2">
              {ROLE_ORDER.map((role) => {
                const checked = values.role === role;
                const locked = isSelf && role !== "ADMIN";
                return (
                  <label
                    key={role}
                    className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-coral-600 ${
                      checked
                        ? "border-ink-900 bg-white shadow-card ring-1 ring-ink-900"
                        : "border-ink-800/12 bg-white/60 hover:border-ink-800/20 hover:bg-white"
                    } ${locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                  >
                    <input
                      type="radio"
                      name={fieldId("role")}
                      value={role}
                      checked={checked}
                      disabled={locked}
                      onChange={() => set("role", role)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink-900">{ROLE_LABEL[role]}</span>
                      <span className="block text-xs leading-snug text-ink-600">{ROLE_HELP[role]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {isSelf && !errors.role && (
              <p className="mt-1.5 text-xs text-ink-500">This is you: you can&apos;t remove your own admin access.</p>
            )}
            {errors.role && <ErrorText id={`${fieldId("role")}-error`}>{errors.role}</ErrorText>}
          </fieldset>
        </Section>
      </SheetBody>

      <SheetFooter>
        <button type="button" onClick={onCancel} disabled={pending} className={`${BTN_SECONDARY} flex-1 md:flex-none`}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={`${BTN_PRIMARY} flex-[2] md:flex-none`}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode.kind === "create" ? (pending ? "Adding…" : "Add person") : pending ? "Saving…" : "Save changes"}
        </button>
      </SheetFooter>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 space-y-4 border-t border-ink-800/8 pt-5">
      <h3 className="font-display text-xl leading-tight text-ink-900">{title}</h3>
      {children}
    </section>
  );
}

function ErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1 text-xs font-medium text-ember-700">
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Label + control + error (or hint). The control wires `${id}-error` / `${id}-hint` into aria-describedby.
 * `hintTone="warn"`: the hint is a heads-up about what saving will do (coral, like the detail's warnings).
 */
function Field({
  id,
  label,
  required = false,
  hint,
  hintTone,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  hintTone?: "warn";
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-ember-600">
            {" "}
            *
          </span>
        )}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <ErrorText id={`${id}-error`}>{error}</ErrorText>
      ) : hint ? (
        <p
          id={`${id}-hint`}
          className={`mt-1.5 text-xs ${hintTone === "warn" ? "font-semibold text-coral-800" : "text-ink-500"}`}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const COLUMNS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3" };

/** A small radio group drawn as segmented buttons. */
function Choice<T extends string>({
  field,
  name,
  legend,
  value,
  onChange,
  options,
  hint,
  error,
}: {
  field: PersonField;
  name: string;
  legend: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  hint?: string;
  error?: string;
}) {
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  return (
    <fieldset data-field={field} aria-describedby={error ? errorId : hint ? hintId : undefined}>
      <legend className={LABEL}>{legend}</legend>
      <div className={`mt-1.5 grid gap-2 ${COLUMNS[options.length] ?? "grid-cols-2"}`}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value || "none"}
              className={`relative flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-coral-600 has-[:focus-visible]:ring-offset-1 ${
                checked
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-ink-800/12 bg-white text-ink-700 hover:border-ink-800/20 hover:bg-sand-50"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.icon}
              {o.label}
            </label>
          );
        })}
      </div>
      {error ? (
        <ErrorText id={errorId}>{error}</ErrorText>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-ink-500">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
