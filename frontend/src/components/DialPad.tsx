import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Phone, Video, Delete } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DialPadProps {
  onCall: (number: string, isVideo: boolean) => void;
  onNumberChange?: (number: string) => void;
  disabled?: boolean;
}

const dialKeys = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "+" },
  { digit: "#", letters: "" },
];

export function DialPad({ onCall, onNumberChange, disabled }: DialPadProps) {
  const [number, setNumber] = useState("");

  useEffect(() => {
    onNumberChange?.(number);
  }, [number, onNumberChange]);

  const handleDigitPress = (digit: string) => {
    if (number.length < 15 && !disabled) {
      setNumber((prev) => prev + digit);
    }
  };

  const handleDelete = () => {
    if (!disabled) {
      setNumber((prev) => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    if (!disabled) {
      setNumber("");
    }
  };

  const formatNumber = (num: string) => {
    if (num.length <= 3) return num;
    if (num.length <= 6) return `${num.slice(0, 3)}-${num.slice(3)}`;
    return `${num.slice(0, 3)}-${num.slice(3, 6)}-${num.slice(6)}`;
  };

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      {/* Number Display */}
      <div className="flex h-16 w-full items-center justify-center">
        <span className="text-3xl font-light tracking-wider text-foreground">
          {formatNumber(number) || (
            <span className="text-muted-foreground">Enter number</span>
          )}
        </span>
      </div>

      {/* Dial Pad Grid */}
      <div className="grid grid-cols-3 gap-4">
        {dialKeys.map(({ digit, letters }) => (
          <motion.button
            key={digit}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleDigitPress(digit)}
            disabled={disabled}
            className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-secondary/50 transition-colors hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="text-2xl font-medium text-foreground">{digit}</span>
            {letters && (
              <span className="text-[10px] tracking-widest text-muted-foreground">
                {letters}
              </span>
            )}
          </motion.button>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-4">
        <Button
          variant="call"
          size="iconLg"
          onClick={() => number && onCall(number, false)}
          disabled={!number || disabled}
        >
          <Phone className="h-6 w-6" />
        </Button>
        <Button
          variant="callMuted"
          size="iconLg"
          onClick={number ? handleDelete : undefined}
          onDoubleClick={handleClear}
          disabled={!number || disabled}
        >
          <Delete className="h-5 w-5" />
        </Button>
        <Button
          variant="gradient"
          size="iconLg"
          onClick={() => number && onCall(number, true)}
          disabled={!number || disabled}
        >
          <Video className="h-6 w-6" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Double-tap delete to clear
      </p>
    </div>
  );
}
