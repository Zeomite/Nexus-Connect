import { motion } from "framer-motion";
import {
  Bell,
  Lock,
  Palette,
  Globe,
  HelpCircle,
  FileText,
  ChevronRight,
  Moon,
  Volume2,
  Shield,
  Smartphone,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SettingItem {
  icon: typeof Bell;
  label: string;
  description?: string;
  hasToggle?: boolean;
  defaultChecked?: boolean;
  onClick?: () => void;
}

interface SettingSection {
  title: string;
  items: SettingItem[];
}

const settingSections: SettingSection[] = [
  {
    title: "Preferences",
    items: [
      { icon: Bell, label: "Notifications", description: "Push, email, and sound alerts", hasToggle: true, defaultChecked: true },
      { icon: Moon, label: "Dark Mode", description: "Use dark theme", hasToggle: true, defaultChecked: true },
      { icon: Volume2, label: "Sounds", description: "Call and message sounds", hasToggle: true, defaultChecked: true },
      { icon: Globe, label: "Language", description: "English (US)" },
    ],
  },
  {
    title: "Privacy & Security",
    items: [
      { icon: Lock, label: "Privacy Settings", description: "Who can see your status and profile" },
      { icon: Shield, label: "Two-Factor Authentication", description: "Add an extra layer of security", hasToggle: true },
      { icon: Smartphone, label: "Linked Devices", description: "Manage devices connected to your account" },
    ],
  },
  {
    title: "Support",
    items: [
      { icon: HelpCircle, label: "Help Center", description: "Get help with common issues" },
      { icon: FileText, label: "Terms & Privacy Policy" },
    ],
  },
];

export default function Settings() {
  return (
    <div className="flex h-full flex-col overflow-y-auto custom-scrollbar p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto w-full max-w-2xl space-y-8"
      >
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>

        {settingSections.map((section, sectionIndex) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: sectionIndex * 0.1 }}
            className="space-y-3"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              {section.title}
            </h2>
            <div className="rounded-2xl bg-card border border-border overflow-hidden">
              {section.items.map((item, itemIndex) => (
                <SettingRow
                  key={item.label}
                  item={item}
                  isLast={itemIndex === section.items.length - 1}
                />
              ))}
            </div>
          </motion.div>
        ))}

        {/* App Info */}
        <div className="text-center text-sm text-muted-foreground pt-4">
          <p>Connect v1.0.0</p>
          <p className="mt-1">Made with ❤️ for seamless communication</p>
        </div>
      </motion.div>
    </div>
  );
}

function SettingRow({ item, isLast }: { item: SettingItem; isLast: boolean }) {
  const Icon = item.icon;

  return (
    <button
      className={cn(
        "flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-secondary/50",
        !isLast && "border-b border-border"
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
        <Icon className="h-5 w-5 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">{item.label}</p>
        {item.description && (
          <p className="text-sm text-muted-foreground truncate">{item.description}</p>
        )}
      </div>
      {item.hasToggle ? (
        <Switch defaultChecked={item.defaultChecked} />
      ) : (
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      )}
    </button>
  );
}
