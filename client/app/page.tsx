import Image from "next/image";
import FileUpload from "./components/file-upload";
import Chatting from "./components/chatting"; // Assuming this component exists

export default function Home() {
  return (
    <div className="text-black min-h-screen min-w-full flex justify-center items-center">
      <div className="w-[50%] p-4">
        <FileUpload/>
      </div>
      <div className="w-[50%] border-l-2 border-violet-700 p-4">
        <Chatting/>
      </div>
    </div>
  );
}