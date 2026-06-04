import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { PhoneCall, MessageSquare, Video, Users, ArrowRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: PhoneCall,
    title: "Crystal Clear Calls",
    description: "HD audio and video calls with minimal latency",
  },
  {
    icon: MessageSquare,
    title: "Instant Messaging",
    description: "Real-time messaging with read receipts",
  },
  {
    icon: Video,
    title: "Video Conferencing",
    description: "Host meetings with up to 100 participants",
  },
  {
    icon: Users,
    title: "Group Management",
    description: "Create groups, split expenses, stay organized",
  },
];

const benefits = [
  "Free HD voice and video calls",
  "End-to-end encrypted messages",
  "Screen sharing and file transfer",
  "Works on any device",
];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen dark">
      {/* Hero Section */}
      <div className="relative overflow-hidden gradient-dark">
        {/* Background Effects */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute top-1/2 -left-20 h-60 w-60 rounded-full bg-accent/20 blur-3xl" />
        </div>

        {/* Navigation */}
        <nav className="relative z-10 flex items-center justify-between px-6 py-4 lg:px-12">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-glow">
              <PhoneCall className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white">Connect</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10">
                Sign in
              </Button>
            </Link>
            <Link to="/register">
              <Button variant="gradient">Get Started</Button>
            </Link>
          </div>
        </nav>

        {/* Hero Content */}
        <div className="relative z-10 px-6 py-20 lg:px-12 lg:py-32">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:gap-20 items-center">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white/80 mb-6">
                  <Sparkles className="h-4 w-4 text-primary" />
                  The future of communication
                </div>
                <h1 className="text-4xl font-bold leading-tight text-white lg:text-6xl">
                  Stay connected,
                  <br />
                  <span className="text-gradient">anywhere you go.</span>
                </h1>
                <p className="mt-6 text-lg text-white/70 max-w-lg">
                  Crystal-clear calls, instant messaging, and seamless video conferencing. 
                  All in one beautiful app that works on every device.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link to="/register">
                    <Button variant="gradient" size="xl" className="gap-2">
                      Start for free
                      <ArrowRight className="h-5 w-5" />
                    </Button>
                  </Link>
                  <Button variant="glass" size="xl">
                    Watch demo
                  </Button>
                </div>

                {/* Trust indicators */}
                <div className="mt-12 flex items-center gap-8">
                  {[
                    { value: "10M+", label: "Users" },
                    { value: "99.9%", label: "Uptime" },
                    { value: "150+", label: "Countries" },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <p className="text-2xl font-bold text-white">{stat.value}</p>
                      <p className="text-sm text-white/60">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Hero Visual */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="relative hidden lg:block"
              >
                <div className="relative rounded-3xl glass p-8 shadow-2xl">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-accent" />
                    <div>
                      <p className="font-medium text-white">Sarah Wilson</p>
                      <p className="text-sm text-white/60">Video call in progress</p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-success animate-pulse" />
                      <span className="text-sm text-white/80">02:34</span>
                    </div>
                  </div>
                  <div className="aspect-video rounded-2xl bg-slate-800/50 flex items-center justify-center">
                    <div className="h-20 w-20 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-2xl font-bold text-white">
                      SW
                    </div>
                  </div>
                  <div className="mt-6 flex justify-center gap-4">
                    {["mic", "video", "screen"].map((control) => (
                      <div
                        key={control}
                        className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center"
                      />
                    ))}
                    <div className="h-12 w-12 rounded-full bg-destructive flex items-center justify-center">
                      <PhoneCall className="h-5 w-5 text-white rotate-135" />
                    </div>
                  </div>
                </div>
                {/* Floating elements */}
                <div className="absolute -top-4 -right-4 rounded-2xl glass p-4 shadow-xl">
                  <MessageSquare className="h-6 w-6 text-primary" />
                </div>
                <div className="absolute -bottom-4 -left-4 rounded-2xl glass p-4 shadow-xl">
                  <Users className="h-6 w-6 text-accent" />
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section className="bg-background py-20 lg:py-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl font-bold text-foreground lg:text-4xl">
              Everything you need to stay connected
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Powerful features designed for seamless communication
            </p>
          </motion.div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="rounded-2xl bg-card p-6 border border-border hover:shadow-lg transition-shadow"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl gradient-primary shadow-glow">
                  <feature.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-2 text-muted-foreground">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="bg-secondary/30 py-20 lg:py-32">
        <div className="mx-auto max-w-6xl px-6 lg:px-12">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-3xl font-bold text-foreground lg:text-4xl">
                Why choose Connect?
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Join millions of users who trust Connect for their daily communication needs.
              </p>
              <div className="mt-8 space-y-4">
                {benefits.map((benefit, index) => (
                  <motion.div
                    key={benefit}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-center gap-3"
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-success/20">
                      <Check className="h-4 w-4 text-success" />
                    </div>
                    <span className="text-foreground">{benefit}</span>
                  </motion.div>
                ))}
              </div>
              <div className="mt-8">
                <Link to="/register">
                  <Button variant="gradient" size="lg" className="gap-2">
                    Get started today
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="relative"
            >
              <div className="rounded-3xl bg-card p-8 border border-border shadow-lg">
                <div className="space-y-4">
                  {[
                    { name: "Sarah Wilson", status: "online", message: "Hey! Want to hop on a quick call?" },
                    { name: "Mike Chen", status: "busy", message: "I'll send the files in 5 mins" },
                    { name: "Emma Thompson", status: "away", message: "Thanks for the update!" },
                  ].map((chat, index) => (
                    <div key={chat.name} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
                      <div className="relative">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-bold text-white">
                          {chat.name.split(" ").map(n => n[0]).join("")}
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card ${
                          chat.status === "online" ? "status-online" : chat.status === "busy" ? "status-busy" : "status-away"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground text-sm">{chat.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{chat.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="gradient-dark py-20 lg:py-32">
        <div className="mx-auto max-w-4xl px-6 lg:px-12 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold text-white lg:text-5xl">
              Ready to get started?
            </h2>
            <p className="mt-4 text-lg text-white/70 max-w-2xl mx-auto">
              Join millions of users and experience the future of communication today.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link to="/register">
                <Button variant="gradient" size="xl" className="gap-2">
                  Create free account
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-card border-t border-border py-12">
        <div className="mx-auto max-w-6xl px-6 lg:px-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
                <PhoneCall className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-foreground">Connect</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 Connect. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
