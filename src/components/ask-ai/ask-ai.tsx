import { useState } from "react"; // Removed useRef import
import { RiSparkling2Fill } from "react-icons/ri";
import { GrSend } from "react-icons/gr";
import classNames from "classnames";
import { toast } from "react-toastify";
import { editor } from "monaco-editor"; // Import editor type

import Login from "../login/login";
import { defaultHTML } from "../../utils/consts";
import SuccessSound from "./../../assets/success.mp3";

function AskAI({
  html, // Current full HTML content (used for initial request and context)
  setHtml, // Used only for full updates now
  onScrollToBottom, // Used for full updates
  isAiWorking,
  setisAiWorking,
  editorRef, // Pass the editor instance ref
}: {
  html: string;
  setHtml: (html: string) => void;
  onScrollToBottom: () => void;
  isAiWorking: boolean;
  setisAiWorking: React.Dispatch<React.SetStateAction<boolean>>;
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>; // Add editorRef prop
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [hasAsked, setHasAsked] = useState(false);
  const [previousPrompt, setPreviousPrompt] = useState("");
  // Removed unused diffBuffer state: const [diffBuffer, setDiffBuffer] = useState("");
  const audio = new Audio(SuccessSound);
  audio.volume = 0.5;

  // --- Diff Constants ---
  const SEARCH_START = "<<<<<<< SEARCH";
  const DIVIDER = "=======";
  const REPLACE_END = ">>>>>>> REPLACE";

  // --- Diff Applying Logic ---

  /**
   * Applies a single parsed diff block to the Monaco editor.
   */
  const applyMonacoDiff = (
    original: string,
    updated: string,
    editorInstance: editor.IStandaloneCodeEditor
  ) => {
    const model = editorInstance.getModel();
    if (!model) {
      console.error("Monaco model not available for applying diff.");
      toast.error("Editor model not found, cannot apply change.");
      return false; // Indicate failure
    }

    // Monaco's findMatches can be sensitive. Let's try a simple search first.
    // We need to be careful about potential regex characters in the original block.
    // Escape basic regex characters for the search string.
    const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Find the first occurrence. Might need more robust logic for multiple identical blocks.
    const matches = model.findMatches(
      escapedOriginal,
      false, // isRegex
      false, // matchCase
      false, // wordSeparators
      null, // searchScope
      true, // captureMatches
      1 // limitResultCount
    );

    if (matches.length > 0) {
      const range = matches[0].range;
      const editOperation = {
        range: range,
        text: updated,
        forceMoveMarkers: true,
      };

      try {
        // Use pushEditOperations for better undo/redo integration if needed,
        // but executeEdits is simpler for direct replacement.
        editorInstance.executeEdits("ai-diff-apply", [editOperation]);
        // Scroll to the change
        editorInstance.revealRangeInCenter(range, editor.ScrollType.Smooth);
        console.log("[Diff Apply] Applied block:", { original, updated });
        return true; // Indicate success
      } catch (editError) {
        console.error("Error applying edit operation:", editError);
        toast.error(`Failed to apply change: ${editError}`);
        return false; // Indicate failure
      }
    } else {
      console.warn("Could not find SEARCH block in editor:", original);
      // Attempt fuzzy match (simple whitespace normalization) as fallback
      const normalizedOriginal = original.replace(/\s+/g, ' ').trim();
      const editorContent = model.getValue();
      const normalizedContent = editorContent.replace(/\s+/g, ' ').trim();
      const startIndex = normalizedContent.indexOf(normalizedOriginal);

      if (startIndex !== -1) {
          console.warn("Applying diff using fuzzy whitespace match.");
          // This is tricky - need to map normalized index back to original positions
          // For now, let's just log and skip applying this specific block
          toast.warn("Could not precisely locate change, skipping one diff block.");
          // TODO: Implement more robust fuzzy matching if needed
      } else {
         toast.error("Could not locate the code block to change. AI might be referencing outdated code.");
      }
      return false; // Indicate failure
    }
  };

  /**
   * Processes the accumulated diff buffer, parsing and applying complete blocks.
   */
  const processDiffBuffer = (
    currentBuffer: string,
    editorInstance: editor.IStandaloneCodeEditor | null
  ): string => {
    if (!editorInstance) return currentBuffer; // Don't process if editor isn't ready

    let remainingBuffer = currentBuffer;
    let appliedSuccess = true;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const searchStartIndex = remainingBuffer.indexOf(SEARCH_START);
      if (searchStartIndex === -1) break; // No more potential blocks

      const dividerIndex = remainingBuffer.indexOf(DIVIDER, searchStartIndex);
      if (dividerIndex === -1) break; // Incomplete block

      const replaceEndIndex = remainingBuffer.indexOf(REPLACE_END, dividerIndex);
      if (replaceEndIndex === -1) break; // Incomplete block

      // Extract the block content
      const originalBlockContent = remainingBuffer
        .substring(searchStartIndex + SEARCH_START.length, dividerIndex)
        .trimEnd(); // Trim potential trailing newline before divider
      const updatedBlockContent = remainingBuffer
        .substring(dividerIndex + DIVIDER.length, replaceEndIndex)
        .trimEnd(); // Trim potential trailing newline before end marker

      // Adjust for newlines potentially trimmed by .trimEnd() if they were intended
      const original = originalBlockContent.startsWith('\n') ? originalBlockContent.substring(1) : originalBlockContent;
      const updated = updatedBlockContent.startsWith('\n') ? updatedBlockContent.substring(1) : updatedBlockContent;


      console.log("[Diff Parse] Found block:", { original, updated });

      // Apply the diff
      appliedSuccess = applyMonacoDiff(original, updated, editorInstance) && appliedSuccess;

      // Remove the processed block from the buffer
      remainingBuffer = remainingBuffer.substring(replaceEndIndex + REPLACE_END.length);
    }

     if (!appliedSuccess) {
         // If any block failed, maybe stop processing further blocks in this stream?
         // Or just let it continue and report errors per block? Let's continue for now.
         console.warn("One or more diff blocks failed to apply.");
     }

    return remainingBuffer; // Return the part of the buffer that couldn't be processed yet
  };


  // --- Main AI Call Logic ---
  // --- Main AI Call Logic ---
  const callAi = async () => {
    if (isAiWorking || !prompt.trim()) return;
    setisAiWorking(true);
    // Removed setDiffBuffer("") call

    let fullContentResponse = ""; // Used for full HTML mode
    let lastRenderTime = 0; // For throttling full HTML updates
    let currentDiffBuffer = ""; // Local variable for buffer within this call

    try {
      const request = await fetch("/api/ask-ai", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          ...(html === defaultHTML ? {} : { html }),
          ...(previousPrompt ? { previousPrompt } : {}),
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (request && request.body) {
        if (!request.ok) {
          const res = await request.json();
          if (res.openLogin) {
            setOpen(true);
          } else {
            // don't show toast if it's a login error
            toast.error(res.message);
          }
          setisAiWorking(false);
          return;
        }

        const responseType = request.headers.get("X-Response-Type") || "full"; // Default to full if header missing
        console.log(`[AI Response] Type: ${responseType}`);

        const reader = request.body.getReader();
        const decoder = new TextDecoder("utf-8");

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("[AI Response] Stream finished.");
            // Process any remaining buffer content in diff mode
            if (responseType === 'diff' && currentDiffBuffer.trim()) {
                 console.warn("[AI Response] Processing remaining diff buffer after stream end:", currentDiffBuffer);
                 const finalRemaining = processDiffBuffer(currentDiffBuffer, editorRef.current);
                 if (finalRemaining.trim()) {
                     console.error("[AI Response] Stream ended with incomplete diff block:", finalRemaining);
                     toast.error("AI response ended with an incomplete change block.");
                 }
                 setDiffBuffer(""); // Clear state buffer
            }
             // Final update for full HTML mode
             if (responseType === 'full') {
                 const finalDoc = fullContentResponse.match(/<!DOCTYPE html>[\s\S]*<\/html>/)?.[0];
                 if (finalDoc) {
                     setHtml(finalDoc); // Ensure final complete HTML is set
                 } else if (fullContentResponse.trim()) {
                     // If we got content but it doesn't look like HTML, maybe it's an error message or explanation?
                     console.warn("[AI Response] Final response doesn't look like HTML:", fullContentResponse);
                     // Decide if we should show this to the user? Maybe a toast?
                     // For now, let's assume the throttled updates were sufficient or it wasn't HTML.
                 }
             }

            toast.success("AI processing complete");
            setPrompt("");
            setPreviousPrompt(prompt);
            setisAiWorking(false);
            setHasAsked(true);
            audio.play();
            break; // Exit the loop
          }

          const chunk = decoder.decode(value, { stream: true });

          if (responseType === 'diff') {
            // --- Diff Mode ---
            currentDiffBuffer += chunk;
            const remaining = processDiffBuffer(currentDiffBuffer, editorRef.current);
            currentDiffBuffer = remaining; // Update local buffer with unprocessed part
            setDiffBuffer(currentDiffBuffer); // Update state for potential display/debugging
          } else {
            // --- Full HTML Mode ---
            fullContentResponse += chunk;
            // Use regex to find the start of the HTML doc
            const newHtmlMatch = fullContentResponse.match(/<!DOCTYPE html>[\s\S]*/);
            const newHtml = newHtmlMatch ? newHtmlMatch[0] : null;

            if (newHtml) {
              // Throttle the re-renders to avoid flashing/flicker
              const now = Date.now();
              if (now - lastRenderTime > 300) {
                 // Force-close the HTML tag for preview if needed
                 let partialDoc = newHtml;
                 if (!partialDoc.trim().endsWith("</html>")) {
                     partialDoc += "\n</html>";
                 }
                setHtml(partialDoc); // Update the preview iframe content
                lastRenderTime = now;
              }

              // Scroll editor down if content is long (heuristic)
              if (newHtml.length > 200 && now - lastRenderTime < 50) { // Only scroll if recently rendered
                onScrollToBottom();
              }
            }
          }
        } // end while loop
      } else {
         throw new Error("Response body is null");
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      setisAiWorking(false);
      toast.error(error.message);
      if (error.openLogin) {
        setOpen(true);
      }
    }
  };

  return (
    <div
      className={`bg-gray-950 rounded-xl py-2 lg:py-2.5 pl-3.5 lg:pl-4 pr-2 lg:pr-2.5 absolute lg:sticky bottom-3 left-3 lg:bottom-4 lg:left-4 w-[calc(100%-1.5rem)] lg:w-[calc(100%-2rem)] z-10 group ${
        isAiWorking ? "animate-pulse" : ""
      }`}
    >
      <div className="w-full relative flex items-center justify-between">
        <RiSparkling2Fill className="text-lg lg:text-xl text-gray-500 group-focus-within:text-pink-500" />
        <input
          type="text"
          disabled={isAiWorking}
          className="w-full bg-transparent max-lg:text-sm outline-none pl-3 text-white placeholder:text-gray-500 font-code"
          placeholder={
            hasAsked ? "What do you want to ask AI next?" : "Ask AI anything..."
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              callAi();
            }
          }}
        />
        <button
          disabled={isAiWorking}
          className="relative overflow-hidden cursor-pointer flex-none flex items-center justify-center rounded-full text-sm font-semibold size-8 text-center bg-pink-500 hover:bg-pink-400 text-white shadow-sm dark:shadow-highlight/20 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
          onClick={callAi}
        >
          <GrSend className="-translate-x-[1px]" />
        </button>
      </div>
      <div
        className={classNames(
          "h-screen w-screen bg-black/20 fixed left-0 top-0 z-10",
          {
            "opacity-0 pointer-events-none": !open,
          }
        )}
        onClick={() => setOpen(false)}
      ></div>
      <div
        className={classNames(
          "absolute top-0 -translate-y-[calc(100%+8px)] right-0 z-10 w-80 bg-white border border-gray-200 rounded-lg shadow-lg transition-all duration-75 overflow-hidden",
          {
            "opacity-0 pointer-events-none": !open,
          }
        )}
      >
        <Login html={html}>
          <p className="text-gray-500 text-sm mb-3">
            You reached the limit of free AI usage. Please login to continue.
          </p>
        </Login>
      </div>
    </div>
  );
}

export default AskAI;
