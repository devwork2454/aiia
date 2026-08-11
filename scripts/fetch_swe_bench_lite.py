import urllib.request
import json
import os

def fetch_swe_bench_lite():
    url = "https://datasets-server.huggingface.co/rows?dataset=princeton-nlp%2FSWE-bench_Lite&config=default&split=test&offset=0&length=10"
    print(f"[*] Fetching real SWE-bench Lite dataset from Hugging Face API...")
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            
        rows = data.get("rows", [])
        instances = [row["row"] for row in rows]
        
        if not instances:
            print("[-] No data found in the response.")
            return

        out_path = os.path.join(os.getcwd(), "artifacts", "swe_bench_lite_mini_10.json")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        
        # We only keep essential fields to keep the JSON concise
        cleaned_instances = []
        for inst in instances:
            cleaned_instances.append({
                "instance_id": inst.get("instance_id"),
                "repo": inst.get("repo"),
                "base_commit": inst.get("base_commit"),
                "problem_statement": inst.get("problem_statement")[:500] + "... [truncated]",
                "version": inst.get("version")
            })
            
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(cleaned_instances, f, indent=2, ensure_ascii=False)
            
        print(f"[+] Successfully fetched {len(cleaned_instances)} SWE-bench Lite instances.")
        print(f"[+] Saved to: {out_path}")
        
    except Exception as e:
        print(f"[!] Error fetching dataset: {e}")

if __name__ == "__main__":
    fetch_swe_bench_lite()
