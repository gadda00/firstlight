#!/bin/bash
# FirstLight Database Migration: SQLite to PostgreSQL
# This script migrates data from SQLite to PostgreSQL

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Validate environment
validate_environment() {
    log_info "Validating environment..."
    
    # Check required commands
    for cmd in sqlite3 psql pg_dump bun node; do
        if ! command_exists "$cmd"; then
            log_error "Required command '$cmd' is not installed"
            exit 1
        fi
    done
    
    # Check SQLite database exists
    if [ ! -f "$SQLITE_DB" ]; then
        log_error "SQLite database '$SQLITE_DB' not found"
        exit 1
    fi
    
    log_success "Environment validation passed"
}

# Parse arguments
SQLITE_DB="${SQLITE_DB:-db/firstlight.db}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-firstlight}"
POSTGRES_USER="${POSTGRES_USER:-firstlight}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
DRY_RUN="${DRY_RUN:-false}"
BACKUP_DIR="${BACKUP_DIR:-./db-backup-$(date +%Y%m%d-%H%M%S)}"

# Show help
show_help() {
    cat << EOF
FirstLight Database Migration: SQLite to PostgreSQL

Usage: $0 [OPTIONS]

Options:
  --sqlite-db PATH       Path to SQLite database (default: db/firstlight.db)
  --postgres-host HOST   PostgreSQL host (default: localhost)
  --postgres-port PORT   PostgreSQL port (default: 5432)
  --postgres-db DB       PostgreSQL database name (default: firstlight)
  --postgres-user USER   PostgreSQL user (default: firstlight)
  --postgres-password PASS PostgreSQL password (required)
  --dry-run              Perform dry run (no actual migration)
  --help                 Show this help message

Examples:
  $0 --postgres-password secret123
  $0 --sqlite-db custom.db --postgres-host db.example.com --postgres-password secret123
  $0 --dry-run --postgres-password secret123

Note: This script requires sqlite3, psql, and bun to be installed.
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --sqlite-db)
            SQLITE_DB="$2"
            shift 2
            ;;
        --postgres-host)
            POSTGRES_HOST="$2"
            shift 2
            ;;
        --postgres-port)
            POSTGRES_PORT="$2"
            shift 2
            ;;
        --postgres-db)
            POSTGRES_DB="$2"
            shift 2
            ;;
        --postgres-user)
            POSTGRES_USER="$2"
            shift 2
            ;;
        --postgres-password)
            POSTGRES_PASSWORD="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate PostgreSQL password
if [ -z "$POSTGRES_PASSWORD" ]; then
    log_error "PostgreSQL password is required"
    show_help
    exit 1
fi

# Main function
main() {
    log_info "=========================================="
    log_info "FirstLight Database Migration"
    log_info "=========================================="
    log_info ""
    
    # Validate environment
    validate_environment
    
    # Show configuration
    log_info "Configuration:"
    log_info "  SQLite DB: $SQLITE_DB"
    log_info "  PostgreSQL Host: $POSTGRES_HOST:$POSTGRES_PORT"
    log_info "  PostgreSQL DB: $POSTGRES_DB"
    log_info "  PostgreSQL User: $POSTGRES_USER"
    log_info "  Dry Run: $DRY_RUN"
    log_info ""
    
    # Create backup directory
    if [ "$DRY_RUN" != "true" ]; then
        log_info "Creating backup directory: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
        
        # Backup SQLite database
        log_info "Backing up SQLite database..."
        cp "$SQLITE_DB" "$BACKUP_DIR/firstlight.db.bak"
        sqlite3 "$SQLITE_DB" ".dump" > "$BACKUP_DIR/firstlight-dump.sql"
        log_success "SQLite database backed up to $BACKUP_DIR"
        log_info ""
    fi
    
    # Check PostgreSQL connection
    log_info "Testing PostgreSQL connection..."
    if PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1" >/dev/null 2>&1; then
        log_success "PostgreSQL connection successful"
    else
        log_error "Failed to connect to PostgreSQL"
        log_error "Please ensure PostgreSQL is running and credentials are correct"
        exit 1
    fi
    log_info ""
    
    # Check if PostgreSQL database exists
    DB_EXISTS=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "postgres" -t -c "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" | tr -d ' \n')
    
    if [ "$DB_EXISTS" != "1" ]; then
        log_warning "PostgreSQL database '$POSTGRES_DB' does not exist"
        if [ "$DRY_RUN" != "true" ]; then
            log_info "Creating PostgreSQL database..."
            PGPASSWORD="$POSTGRES_PASSWORD" createdb -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$POSTGRES_DB"
            log_success "PostgreSQL database created"
        else
            log_info "[DRY RUN] Would create PostgreSQL database"
        fi
    fi
    log_info ""
    
    # Check if PostgreSQL schema exists
    SCHEMA_EXISTS=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' LIMIT 1" | tr -d ' \n')
    
    if [ "$SCHEMA_EXISTS" = "1" ]; then
        log_warning "PostgreSQL schema already exists in '$POSTGRES_DB'"
        if [ "$DRY_RUN" != "true" ]; then
            read -p "Do you want to DROP and recreate the schema? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Skipping migration to preserve existing data"
                exit 0
            fi
            log_info "Dropping existing schema..."
            PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
            log_success "Schema dropped and recreated"
        else
            log_info "[DRY RUN] Would drop and recreate schema"
        fi
    fi
    log_info ""
    
    # Run Prisma migration
    log_info "Running Prisma migration..."
    if [ "$DRY_RUN" != "true" ]; then
        export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"
        bunx prisma db push --force-reset
        log_success "Prisma migration completed"
    else
        log_info "[DRY RUN] Would run Prisma migration"
        log_info "  DATABASE_URL=postgresql://${POSTGRES_USER}:****@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
    fi
    log_info ""
    
    # Migrate data from SQLite to PostgreSQL
    log_info "Migrating data from SQLite to PostgreSQL..."
    
    # Get list of tables from SQLite
    SQLite_TABLES=$(sqlite3 "$SQLITE_DB" ".tables" | tr -d ' \n' | grep -v sqlite_sequence)
    
    if [ -z "$SQLite_TABLES" ]; then
        log_warning "No tables found in SQLite database"
    else
        log_info "Found tables in SQLite: $SQLite_TABLES"
        
        # Migrate each table
        for table in $SQLite_TABLES; do
            log_info "  Migrating table: $table"
            
            if [ "$DRY_RUN" != "true" ]; then
                # Export data from SQLite
                SQLite_DATA=$(sqlite3 "$SQLITE_DB" "SELECT * FROM \"$table\";" -csv)
                
                if [ -n "$SQLite_DATA" ]; then
                    # Import data to PostgreSQL
                    echo "$SQLite_DATA" | PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\COPY $table FROM STDIN WITH CSV"
                    log_success "    Table '$table' migrated"
                else
                    log_info "    Table '$table' is empty, skipping"
                fi
            else
                log_info "    [DRY RUN] Would migrate table '$table'"
            fi
        done
    fi
    log_info ""
    
    # Verify migration
    log_info "Verifying migration..."
    if [ "$DRY_RUN" != "true" ]; then
        # Count records in SQLite
        SQLite_COUNT=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' UNION ALL SELECT 1 FROM sqlite_master WHERE type='table' AND name LIKE 'sqlite_%')")
        
        # Count records in PostgreSQL
        PG_COUNT=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c "SELECT COUNT(*) FROM (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' LIMIT 1)" | tr -d ' \n')
        
        if [ "$SQLite_COUNT" -gt 0 ] && [ "$PG_COUNT" -gt 0 ]; then
            log_success "Migration verification passed"
        else
            log_warning "Migration verification: SQLite has $SQLite_COUNT tables, PostgreSQL has $PG_COUNT tables"
        fi
    else
        log_info "[DRY RUN] Migration verification skipped"
    fi
    log_info ""
    
    # Run Prisma seed
    log_info "Running Prisma seed..."
    if [ "$DRY_RUN" != "true" ]; then
        export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"
        bun run db:seed
        log_success "Prisma seed completed"
    else
        log_info "[DRY RUN] Would run Prisma seed"
    fi
    log_info ""
    
    # Final summary
    log_info "=========================================="
    log_info "Migration Summary"
    log_info "=========================================="
    log_info "SQLite Database: $SQLITE_DB"
    log_info "PostgreSQL Database: $POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
    log_info "Backup Directory: $BACKUP_DIR"
    log_info "Dry Run: $DRY_RUN"
    log_info ""
    
    if [ "$DRY_RUN" != "true" ]; then
        log_success "Migration completed successfully!"
        log_info ""
        log_info "Next steps:"
        log_info "  1. Verify data in PostgreSQL"
        log_info "  2. Test application with PostgreSQL"
        log_info "  3. Update DATABASE_URL in .env"
        log_info "  4. Deploy to production"
    else
        log_info "[DRY RUN] Migration would have completed successfully"
        log_info ""
        log_info "To perform actual migration, run without --dry-run flag"
    fi
    log_info "=========================================="
}

# Run main function
main "$@"
