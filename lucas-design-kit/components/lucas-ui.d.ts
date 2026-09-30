import type * as React from 'react';
export type Tone = 'morado' | 'naranja' | 'azul' | 'coral' | 'verde' | 'amarillo' | 'turquesa' | 'rosa';
export declare function formatCOP(n: number, opts?: { sign?: boolean }): string;
export declare function lucas(n: number): string;
export declare function setTones(map: Record<string, Tone>): void;
export declare function toneFor(name: string): Tone;
export interface BillCardProps { label: React.ReactNode; amount: number; tone?: 'verde' | 'morado'; denom?: string; aside?: React.ReactNode; roll?: boolean; highlight?: boolean; children?: React.ReactNode }
export declare function BillCard(props: BillCardProps): React.ReactElement;
export interface ExpenseCardProps { merchant: React.ReactNode; category?: string; meta?: React.ReactNode; total?: number; each?: React.ReactNode; sticker?: React.ReactNode; appear?: boolean; onClick?: () => void; flat?: boolean; className?: string; style?: React.CSSProperties; children?: React.ReactNode }
export declare function ExpenseCard(props: ExpenseCardProps): React.ReactElement;
export interface RowProps { label: React.ReactNode; amount?: number; value?: React.ReactNode; muted?: boolean; total?: boolean }
export declare function Row(props: RowProps): React.ReactElement;
export interface StickerProps { tone?: 'pagado' | 'confirmado' | 'revisar' | 'pendiente' | 'alerta' | 'cerrado'; children?: React.ReactNode; sub?: string; size?: 'sm' | 'md' | 'lg'; rotate?: number; animate?: boolean; className?: string }
export declare function Sticker(props: StickerProps): React.ReactElement;
export interface AmountProps { value: number; size?: 'sm' | 'md' | 'lg' | 'xl'; highlight?: boolean; roll?: boolean; tone?: 'pos' | 'neg'; sign?: boolean; className?: string }
export declare function Amount(props: AmountProps): React.ReactElement;
export interface DividerProps { variant?: 'line' | 'wave'; label?: React.ReactNode; className?: string }
export declare function Divider(props: DividerProps): React.ReactElement;
export interface CorrectionProps { was?: React.ReactNode; by?: string; tone?: Tone; children: React.ReactNode }
export declare function Correction(props: CorrectionProps): React.ReactElement;
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'outline' | 'ghost'; size?: 'md' | 'sm'; kbd?: string }
export declare function Button(props: ButtonProps): React.ReactElement;
export interface FieldProps { label: string; value?: string; onChange?: (v: string) => void; confidence?: number; original?: string; corrected?: boolean; correctedBy?: string; num?: boolean; inputMode?: string; id?: string; children?: React.ReactNode }
export declare function Field(props: FieldProps): React.ReactElement;
export interface ConfidenceProps { value: number; corrected?: boolean }
export declare function Confidence(props: ConfidenceProps): React.ReactElement;
export interface ChipProps { name?: string; tone?: Tone; pressed?: boolean; onToggle?: () => void; children?: React.ReactNode }
export declare function Chip(props: ChipProps): React.ReactElement;
export interface BudgetBarProps { name: string; spent: number; budget: number; category?: boolean }
export declare function BudgetBar(props: BudgetBarProps): React.ReactElement;
export interface CategoryTagProps { name: string; showName?: boolean; size?: 'sm' | 'md' | 'lg' }
export declare function CategoryTag(props: CategoryTagProps): React.ReactElement;
export interface AvatarProps { name: string; tone?: Tone; size?: 'xs' | 'sm' | 'md'; registered?: boolean }
export declare function Avatar(props: AvatarProps): React.ReactElement;
export interface PersonProps { name: string; sub?: React.ReactNode; tone?: Tone; registered?: boolean; role?: 'owner' | 'admin' | 'member'; size?: 'xs' | 'sm' | 'md'; aside?: React.ReactNode }
export declare function Person(props: PersonProps): React.ReactElement;
export interface EvidenceProps { kind?: 'foto' | 'pdf' | 'mensaje'; sender: string; time: string; group?: string; file?: string; pages?: number; receipt?: { title: string; sub?: string; lines?: [string, string][]; total: string; foot?: string }; messages?: { who: string; whoColor?: string; text: string; time: string; dim?: boolean; target?: boolean }[]; box?: string }
export declare function Evidence(props: EvidenceProps): React.ReactElement;
export interface CodeInputProps { value?: string; onChange?: (v: string) => void; label?: string; hint?: string; error?: string | null; readOnly?: boolean; id?: string }
export declare function CodeInput(props: CodeInputProps): React.ReactElement;
export interface ConnectionStatusProps { state?: 'esperando' | 'conectado' | 'error'; children?: React.ReactNode; sub?: React.ReactNode }
export declare function ConnectionStatus(props: ConnectionStatusProps): React.ReactElement;
export interface LottieSlotProps { name: string; width?: number; height?: number; square?: boolean; label?: string; src?: string }
export declare function LottieSlot(props: LottieSlotProps): React.ReactElement;
export interface LogoProps { size?: number }
export declare function Logo(props: LogoProps): React.ReactElement;
export interface AppShellProps { account?: string; accountTone?: Tone; accountGlyph?: string; tabs?: { id: string; label: string; count?: number; icon?: string }[]; active?: string; onTab?: (id: string) => void; onAccount?: () => void; children?: React.ReactNode }
export declare function AppShell(props: AppShellProps): React.ReactElement;
