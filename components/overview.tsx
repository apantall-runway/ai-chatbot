import { motion } from 'framer-motion';
// Removed Link and VercelIcon/MessageIcon imports as they are no longer needed here

export const Overview = () => {
  return (
    <motion.div
      key="overview"
      // Max width can be adjusted for desired text line length
      className="max-w-xl mx-auto flex flex-col items-center justify-center text-center h-full pb-32" // Center vertically & horizontally, add bottom padding
      initial={{ opacity: 0, y: 20 }} // Subtle fade-in animation
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
    >
      <h1 className="text-3xl font-rubik-mono uppercase tracking-wider mb-6">
        pulse.
      </h1>

      {/* Descriptive Text - Use Geist Sans */}
      <p className="text-lg font-sans mb-2 text-foreground/80">
        Beyond conversation.
      </p>
      <p className="text-lg font-sans mb-6 text-foreground/80">
        A workspace for thought, augmented.
      </p>

      {/* Action Verbs - Use Geist Mono for a slightly technical feel */}
      <p className="text-md font-mono mb-8 text-foreground/70 tracking-wide">
        Define. Generate. Refine.
      </p>

      {/* Final Question - Italics for emphasis */}
      <p className="text-lg font-sans italic text-foreground/90">
        What will you construct?
      </p>
    </motion.div>
  );
};
