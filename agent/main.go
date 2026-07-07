package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
)

const version = "1.0.0"

type Message struct {
	Type        string      `json:"type"`
	Token       string      `json:"token,omitempty"`
	ReqID       string      `json:"reqId,omitempty"`
	Commands    []string    `json:"commands,omitempty"`
	Results     []string    `json:"results,omitempty"`
	Error       string      `json:"error,omitempty"`
	Data        interface{} `json:"data,omitempty"`
	Version     string      `json:"version,omitempty"`
	Action      string      `json:"action,omitempty"`
	ContainerID string      `json:"containerId,omitempty"`
	Name        string      `json:"name,omitempty"`
	Image       string      `json:"image,omitempty"`
	Ports       string      `json:"ports,omitempty"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins since we secure via token
	},
}

var expectedToken string

func main() {
	port := flag.String("port", "44333", "The port for the WebSocket server to listen on")
	token := flag.String("token", "", "Authentication token to allow connections")
	flag.Parse()

	if *token == "" {
		fmt.Println("Usage: omicron-agent -port <port> -token <auth_token>")
		os.Exit(1)
	}

	expectedToken = *token

	http.HandleFunc("/ws/agent", handleConnections)

	addr := "0.0.0.0:" + *port
	log.Printf("Agent listening on ws://%s/ws/agent", addr)
	err := http.ListenAndServe(addr, nil)
	if err != nil {
		log.Fatal("ListenAndServe error:", err)
	}
}

var writeMutex sync.Mutex

func safeWriteJSON(c *websocket.Conn, msg interface{}) error {
	writeMutex.Lock()
	defer writeMutex.Unlock()
	return c.WriteJSON(msg)
}

func handleConnections(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	defer c.Close()

	log.Println("Client connected. Waiting for authentication...")

	authenticated := false

	// Listen for commands
	for {
		var msg Message
		err := c.ReadJSON(&msg)
		if err != nil {
			log.Println("Read error:", err)
			return
		}

		if !authenticated {
			if msg.Type == "auth" && msg.Token == expectedToken {
				authenticated = true
				log.Println("Client authenticated successfully.")
				// Send a success ack back
				safeWriteJSON(c, Message{Type: "auth_success", Version: version})
				
				// Start streaming metrics, syslog, and docker
				go streamMetrics(c)
				go streamSyslog(c)
				go streamDocker(c)
				go sendDockerStatus(c)
			} else {
				log.Println("Authentication failed.")
				return // close connection
			}
			continue
		}

		if msg.Type == "exec" {
			go handleExec(c, msg.Commands, msg.ReqID)
		} else if msg.Type == "ping" {
			safeWriteJSON(c, Message{Type: "pong"})
		} else if msg.Type == "docker-action" {
			go handleDockerAction(c, msg.Action, msg.ContainerID)
		} else if msg.Type == "docker-deploy" {
			go handleDockerDeploy(c, msg.Name, msg.Image, msg.Ports)
		}
	}
}

type MetricsData struct {
	CPUUsage      float64 `json:"cpu_usage"`
	LoadAvg1      float64 `json:"load_avg_1"`
	LoadAvg5      float64 `json:"load_avg_5"`
	LoadAvg15     float64 `json:"load_avg_15"`
	MemTotal      uint64  `json:"mem_total"`
	MemUsed       uint64  `json:"mem_used"`
	MemFree       uint64  `json:"mem_free"`
	MemPercent    float64 `json:"mem_percent"`
	DiskTotal     uint64  `json:"disk_total"`
	DiskUsed      uint64  `json:"disk_used"`
	DiskFree      uint64  `json:"disk_free"`
	DiskPercent   float64 `json:"disk_percent"`
	ServicesCount int     `json:"services_count"` // Simplification for now
}

func streamMetrics(c *websocket.Conn) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// Collect CPU
		cpuPercents, _ := cpu.Percent(0, false)
		var cpuUsage float64
		if len(cpuPercents) > 0 {
			cpuUsage = cpuPercents[0]
		}

		// Collect Load Avg
		loadStat, _ := load.Avg()
		var load1, load5, load15 float64
		if loadStat != nil {
			load1 = loadStat.Load1
			load5 = loadStat.Load5
			load15 = loadStat.Load15
		}

		// Collect Memory
		vmStat, _ := mem.VirtualMemory()
		var memTotal, memUsed, memFree uint64
		var memPercent float64
		if vmStat != nil {
			memTotal = vmStat.Total / 1024 / 1024 // MB
			memFree = vmStat.Free / 1024 / 1024
			memUsed = vmStat.Used / 1024 / 1024
			memPercent = vmStat.UsedPercent
		}

		// Collect Disk
		diskStat, _ := disk.Usage("/")
		var diskTotal, diskUsed, diskFree uint64
		var diskPercent float64
		if diskStat != nil {
			diskTotal = diskStat.Total / 1024 / 1024 / 1024 // GB
			diskFree = diskStat.Free / 1024 / 1024 / 1024
			diskUsed = diskStat.Used / 1024 / 1024 / 1024
			diskPercent = diskStat.UsedPercent
		}

		metrics := MetricsData{
			CPUUsage:    cpuUsage,
			LoadAvg1:    load1,
			LoadAvg5:    load5,
			LoadAvg15:   load15,
			MemTotal:    memTotal,
			MemUsed:     memUsed,
			MemFree:     memFree,
			MemPercent:  memPercent,
			DiskTotal:   diskTotal,
			DiskUsed:    diskUsed,
			DiskFree:    diskFree,
			DiskPercent: diskPercent,
		}

		msg := Message{
			Type: "vm-resource-utilization-info",
			Data: metrics,
			Version: version,
		}
		
		err := safeWriteJSON(c, msg)
		if err != nil {
			log.Println("Metrics stream error:", err)
			return
		}
	}
}

func handleExec(c *websocket.Conn, commands []string, reqID string) {
	if len(commands) == 0 {
		return
	}

	var results []string

	// Execute each command and capture output
	for _, cmdStr := range commands {
		cmd := exec.Command("bash", "-c", cmdStr)
		var out bytes.Buffer
		var stderr bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &stderr

		err := cmd.Run()
		if err != nil {
			results = append(results, fmt.Sprintf("Error: %v\n%s", err, stderr.String()))
		} else {
			results = append(results, out.String())
		}
	}

	// Send results back
	resp := Message{
		Type:    "exec_result",
		ReqID:   reqID,
		Results: results,
	}

	err := safeWriteJSON(c, resp)
	if err != nil {
		log.Println("Failed to send results:", err)
	}
}

func streamSyslog(c *websocket.Conn) {
	// Try running journalctl -f -n 0
	cmd := exec.Command("journalctl", "-f", "-n", "0")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		// Fallback to tail -f /var/log/syslog
		cmd = exec.Command("tail", "-f", "-n", "0", "/var/log/syslog")
		stdout, err = cmd.StdoutPipe()
		if err != nil {
			log.Println("Failed to start log tailing:", err)
			return
		}
	}

	if err := cmd.Start(); err != nil {
		// Fallback: let's try tail -f /var/log/syslog directly
		cmd = exec.Command("tail", "-f", "-n", "0", "/var/log/syslog")
		stdout, err = cmd.StdoutPipe()
		if err != nil {
			log.Println("Failed to start fallback log tailing:", err)
			return
		}
		if err := cmd.Start(); err != nil {
			log.Println("Failed to start fallback log command:", err)
			return
		}
	}
	defer func() {
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
	}()

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		msg := Message{
			Type: "syslog-line",
			Data: line,
			Version: version,
		}
		err := safeWriteJSON(c, msg)
		if err != nil {
			log.Println("Syslog stream write error:", err)
			return
		}
	}
}

type DockerContainer struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	Status string `json:"status"`
	State  string `json:"state"`
	Ports  string `json:"ports"`
}

func getDockerContainers() ([]DockerContainer, error) {
	path, err := exec.LookPath("docker")
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(path, "ps", "-a", "--format", `{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}","ports":"{{.Ports}}"}`)
	var out bytes.Buffer
	cmd.Stdout = &out
	err = cmd.Run()
	if err != nil {
		return nil, err
	}

	lines := strings.Split(out.String(), "\n")
	var list []DockerContainer
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var c DockerContainer
		if err := json.Unmarshal([]byte(line), &c); err == nil {
			list = append(list, c)
		}
	}
	return list, nil
}

func sendDockerStatus(c *websocket.Conn) {
	installed := false
	_, err := exec.LookPath("docker")
	if err == nil {
		installed = true
	}

	var list []DockerContainer
	if installed {
		list, _ = getDockerContainers()
	}

	type DockerStatusData struct {
		Installed bool              `json:"installed"`
		List      []DockerContainer `json:"list"`
	}

	msg := Message{
		Type: "docker-status",
		Data: DockerStatusData{
			Installed: installed,
			List:      list,
		},
		Version: version,
	}

	safeWriteJSON(c, msg)
}

func streamDocker(c *websocket.Conn) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		sendDockerStatus(c)
	}
}

func handleDockerAction(c *websocket.Conn, action string, containerID string) {
	dockerPath, err := exec.LookPath("docker")
	if err != nil {
		log.Println("Docker not found for action")
		return
	}

	if action != "start" && action != "stop" && action != "restart" && action != "remove" {
		log.Println("Invalid Docker action:", action)
		return
	}

	dockerArg := action
	if action == "remove" {
		dockerArg = "rm"
	}

	cmd := exec.Command(dockerPath, dockerArg, containerID)
	_ = cmd.Run()

	sendDockerStatus(c)
}

func handleDockerDeploy(c *websocket.Conn, name string, image string, ports string) {
	dockerPath, err := exec.LookPath("docker")
	if err != nil {
		log.Println("Docker not found for deploy")
		return
	}

	args := []string{"run", "-d"}
	if name != "" {
		args = append(args, "--name", name)
	}
	if ports != "" {
		args = append(args, "-p", ports)
	}
	args = append(args, image)

	cmd := exec.Command(dockerPath, args...)
	_ = cmd.Run()

	sendDockerStatus(c)
}
