import type { ComponentType } from 'react';
import type { StyleProp } from 'react-native';

const AlertTriangle = require('../node_modules/lucide-react-native/dist/cjs/icons/triangle-alert.js');
const BarChart3 = require('../node_modules/lucide-react-native/dist/cjs/icons/chart-bar.js');
const Bell = require('../node_modules/lucide-react-native/dist/cjs/icons/bell.js');
const Camera = require('../node_modules/lucide-react-native/dist/cjs/icons/camera.js');
const Car = require('../node_modules/lucide-react-native/dist/cjs/icons/car.js');
const CheckCircle2 = require('../node_modules/lucide-react-native/dist/cjs/icons/circle-check-big.js');
const ChevronDown = require('../node_modules/lucide-react-native/dist/cjs/icons/chevron-down.js');
const ChevronLeft = require('../node_modules/lucide-react-native/dist/cjs/icons/chevron-left.js');
const ChevronRight = require('../node_modules/lucide-react-native/dist/cjs/icons/chevron-right.js');
const ChevronUp = require('../node_modules/lucide-react-native/dist/cjs/icons/chevron-up.js');
const CircleDollarSign = require('../node_modules/lucide-react-native/dist/cjs/icons/circle-dollar-sign.js');
const ClipboardList = require('../node_modules/lucide-react-native/dist/cjs/icons/clipboard-list.js');
const Copy = require('../node_modules/lucide-react-native/dist/cjs/icons/copy.js');
const CreditCard = require('../node_modules/lucide-react-native/dist/cjs/icons/credit-card.js');
const Eye = require('../node_modules/lucide-react-native/dist/cjs/icons/eye.js');
const EyeOff = require('../node_modules/lucide-react-native/dist/cjs/icons/eye-off.js');
const FingerprintPattern = require('../node_modules/lucide-react-native/dist/cjs/icons/fingerprint-pattern.js');
const Home = require('../node_modules/lucide-react-native/dist/cjs/icons/house.js');
const Inbox = require('../node_modules/lucide-react-native/dist/cjs/icons/inbox.js');
const LogOut = require('../node_modules/lucide-react-native/dist/cjs/icons/log-out.js');
const MapPin = require('../node_modules/lucide-react-native/dist/cjs/icons/map-pin.js');
const Menu = require('../node_modules/lucide-react-native/dist/cjs/icons/menu.js');
const MessageCircle = require('../node_modules/lucide-react-native/dist/cjs/icons/message-circle.js');
const Pencil = require('../node_modules/lucide-react-native/dist/cjs/icons/pencil.js');
const Phone = require('../node_modules/lucide-react-native/dist/cjs/icons/phone.js');
const RefreshCw = require('../node_modules/lucide-react-native/dist/cjs/icons/refresh-cw.js');
const Ruler = require('../node_modules/lucide-react-native/dist/cjs/icons/ruler.js');
const Send = require('../node_modules/lucide-react-native/dist/cjs/icons/send.js');
const Smartphone = require('../node_modules/lucide-react-native/dist/cjs/icons/smartphone.js');
const Star = require('../node_modules/lucide-react-native/dist/cjs/icons/star.js');
const Store = require('../node_modules/lucide-react-native/dist/cjs/icons/store.js');
const Target = require('../node_modules/lucide-react-native/dist/cjs/icons/target.js');
const Timer = require('../node_modules/lucide-react-native/dist/cjs/icons/timer.js');
const Trash2 = require('../node_modules/lucide-react-native/dist/cjs/icons/trash-2.js');
const User = require('../node_modules/lucide-react-native/dist/cjs/icons/user.js');
const Wallet = require('../node_modules/lucide-react-native/dist/cjs/icons/wallet.js');
const Wrench = require('../node_modules/lucide-react-native/dist/cjs/icons/wrench.js');
const X = require('../node_modules/lucide-react-native/dist/cjs/icons/x.js');

type LucideIcon = ComponentType<any>;

const icons = {
  alert: AlertTriangle,
  bell: Bell,
  camera: Camera,
  chart: BarChart3,
  car: Car,
  check: CheckCircle2,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  close: X,
  copy: Copy,
  creditCard: CreditCard,
  dollar: CircleDollarSign,
  eye: Eye,
  eyeOff: EyeOff,
  fingerprint: FingerprintPattern,
  home: Home,
  inbox: Inbox,
  list: ClipboardList,
  logout: LogOut,
  mapPin: MapPin,
  menu: Menu,
  message: MessageCircle,
  pencil: Pencil,
  phone: Phone,
  refresh: RefreshCw,
  ruler: Ruler,
  send: Send,
  smartphone: Smartphone,
  star: Star,
  store: Store,
  target: Target,
  timer: Timer,
  trash: Trash2,
  user: User,
  wallet: Wallet,
  wrench: Wrench,
} satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof icons;

type AppIconProps = {
  name: AppIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<any>;
};

export function AppIcon({
  name,
  size = 24,
  color = '#333',
  strokeWidth = 2,
  style,
}: AppIconProps) {
  const Icon = icons[name];
  return <Icon size={size} color={color} strokeWidth={strokeWidth} style={style} />;
}
