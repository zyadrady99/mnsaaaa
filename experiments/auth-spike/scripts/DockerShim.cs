using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

// Native Windows launcher: forward every argument without invoking cmd/PowerShell.
// The Node adapter applies changes only to this experiment's three containers.
internal static class DockerShim
{
    private static string QuoteArgument(string argument)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in argument)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"')
            {
                result.Append('\\', slashes * 2 + 1);
                result.Append('"');
            }
            else
            {
                result.Append('\\', slashes);
                result.Append(character);
            }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static int Main(string[] arguments)
    {
        string adapter = Environment.GetEnvironmentVariable("DOROSNA_DOCKER_ADAPTER");
        if (String.IsNullOrEmpty(adapter) || !File.Exists(adapter))
        {
            Console.Error.WriteLine("Local Docker adapter path is unavailable.");
            return 1;
        }
        ProcessStartInfo start = new ProcessStartInfo(@"C:\Program Files\nodejs\node.exe");
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardInput = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.Arguments = QuoteArgument(adapter);
        foreach (string argument in arguments) start.Arguments += " " + QuoteArgument(argument);
        try
        {
            using (Process child = Process.Start(start))
            {
                Task output = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
                Task errors = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
                Task input = Console.OpenStandardInput().CopyToAsync(child.StandardInput.BaseStream);
                input.ContinueWith(delegate(Task ignored)
                {
                    try { child.StandardInput.Close(); } catch { }
                });
                child.WaitForExit();
                Task.WaitAll(output, errors);
                return child.ExitCode;
            }
        }
        catch
        {
            Console.Error.WriteLine("The local Docker adapter could not be started.");
            return 1;
        }
    }
}
