import { useState } from "react";
import { RiSparkling2Fill } from "react-icons/ri";
import { GrSend } from "react-icons/gr";
import classNames from "classnames";
import { toast } from "react-toastify";
// Removed monaco editor import

import Login from "../login/login";
import { defaultHTML } from "../../utils/consts";
import SuccessSound from "./../../assets/success.mp3";

function AskAI({
  html, // Current full HTML content (used for initial request and context)
  setHtml, // Used for updates (both full and diff-based)
  onScrollToBottom, // Used for full updates
  isAiWorking,
  setisAiWorking,
}: {
  html: string;
  setHtml: (html: string) => void;
  onScrollToBottom: () => void;
  isAiWorking: boolean;
  setisAiWorking: React.Dispatch<React.SetStateAction<boolean>>;
  // Removed editorRef prop
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [hasAsked, setHasAsked] = useState(false);
  const [previousPrompt, setPreviousPrompt] = useState("");
  const audio = new Audio(SuccessSound);
  audio.volume = 0.5;

  // Removed client-side diff parsing/applying logic
  // --- Main AI Call Logic ---
  const callAi = async () => {
    if (isAiWorking || !prompt.trim()) return;
    const originalHtml = html; // Store the HTML state at the start of the request
    setisAiWorking(true);

    let fullContentResponse = ""; // Used for full HTML mode
    let accumulatedDiffResponse = ""; // Used for diff mode
    let lastRenderTime = 0; // For throttling full HTML updates

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

            // --- Post-stream processing ---
            if (responseType === 'diff') {
              // Apply diffs server-side
              try {
                console.log("[Diff Apply] Sending original HTML and AI diff response to server...");
                const applyRequest = await fetch("/api/apply-diffs", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    originalHtml: originalHtml, // Send the HTML from the start of the request
                    aiResponseContent: accumulatedDiffResponse,
                  }),
                });

                if (!applyRequest.ok) {
                  const errorData = await applyRequest.json();
                  throw new Error(errorData.message || `Server failed to apply diffs (status ${applyRequest.status})`);
                }

                const patchedHtml = await applyRequest.text();
                console.log("[Diff Apply] Received patched HTML from server.");
                setHtml(patchedHtml); // Update editor with the final result
                toast.success("AI changes applied");

              } catch (applyError: any) {
                console.error("Error applying diffs server-side:", applyError);
                toast.error(`Failed to apply AI changes: ${applyError.message}`);
                // Optionally revert to originalHtml? Or leave the editor as is?
                // setHtml(originalHtml); // Uncomment to revert on failure
              }

            } else {
              // Final update for full HTML mode
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
            accumulatedDiffResponse += chunk; // Just accumulate the raw response
          } else {
            // --- Full HTML Mode ---
            fullContentResponse += chunk; // Accumulate for preview
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
